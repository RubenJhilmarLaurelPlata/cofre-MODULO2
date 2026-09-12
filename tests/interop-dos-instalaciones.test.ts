// tests/interop-dos-instalaciones.test.ts
// Fase 4.3, punto 12: demostración con DOS bases de datos SQLite
// realmente separadas y un servidor HTTP real (loopback), probando el
// flujo "B consulta a A" de punta a punta.
//
// QUÉ SÍ es real aquí: dos archivos SQLite físicamente distintos, cada
// uno con su propio PrismaClient; un servidor HTTP real (Node `http`,
// puerto efímero); la firma/verificación HMAC real de src/lib/interop/
// (nada mockeado); el cliente HTTP saliente real (consultarEnvioRemoto).
//
// Fase 4.4 extiende esta misma demostración con la primera ESCRITURA real
// entre instalaciones: B pide recepción a A (POST /recibir) y luego
// materializa sus propios Package — ver el segundo describe() más abajo.
//
// QUÉ NO es esto — limitación explícita, ver informes de Fase 4.3/4.4:
//   - No son dos procesos de Next.js reales (no hay `next dev`/`next start`
//     corriendo dos veces) — es un `http.createServer` plano que reimplementa
//     el mismo cableado que route.ts, porque src/lib/interop-envios.ts (y
//     recibirEnvio()/src/lib/envios.ts) usan el PrismaClient SINGLETON de
//     src/lib/prisma.ts (bindeado a UNA sola DATABASE_URL por proceso) y no
//     aceptan un cliente inyectado — cambiar eso solo para esta prueba se
//     consideró fuera del alcance de estas fases (no tocar esos archivos
//     más de lo necesario). Por eso el lado "A" (origen) de la prueba de
//     Fase 4.4 reimplementa a mano la transición CERRADO->RECIBIDO contra
//     prismaInstalacionA — el lado "B" (destino), en cambio, SÍ usa
//     materializarRecepcionRemota() real (esa función ya usa el singleton
//     compartido de este proceso de tests, que en esta demostración hace
//     de base de datos de B).
//   - No usa HTTPS (loopback en texto plano) — la validez de la firma no
//     depende del transporte, pero HTTPS real es responsabilidad de la
//     infraestructura de despliegue (fuera del alcance de código).
//   - No corre en paralelo con un `next dev` real: es autocontenida dentro
//     de este archivo de test.
//
// Lo que SÍ queda demostrado: que el protocolo (headers, canonical
// string, HMAC, DTO) funciona de punta a punta entre dos bases de datos
// genuinamente independientes, sin que "B" necesite tocar la base de "A"
// para nada que no sea a través de estos dos endpoints HTTP autenticados
// — y que un reintento completo (simulando una respuesta perdida) nunca
// duplica ni la recepción en A ni los Package materializados en B.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import { prisma as prismaCompartidoDeTests } from '@/lib/prisma';
import { verificarFirmaInterop, compararTimingSafe, consultarEnvioRemoto, recibirEnvioRemoto, type EnvioInteropDTO } from '@/lib/interop';
import { materializarRecepcionRemota } from '@/lib/interop-envios';

const SECRETO_COMPARTIDO_ELA = 'test-secret-el-alto-dos-instalaciones';

const dbPathInstalacionA = path.join(os.tmpdir(), `cofre-interop-instalacion-a-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const dbUrlInstalacionA = `file:${dbPathInstalacionA}?connection_limit=1`;

let prismaInstalacionA: PrismaClient;
let servidorInstalacionA: Server;
let urlBaseInstalacionA: string;
let codigoEnvioDePrueba: string;

/**
 * Réplica MÍNIMA de getEnvioParaInterop() (src/lib/interop-envios.ts),
 * pero parametrizada con el PrismaClient de la "instalación A" en vez del
 * singleton compartido — existe SOLO para esta prueba (ver limitación
 * documentada arriba). El endpoint real de producción (route.ts) usa la
 * versión de interop-envios.ts tal cual, probada aparte en
 * tests/interop-envios-route.test.ts.
 */
async function resolverEnvioEnInstalacionA(codigo: string, sucursalSolicitanteCodigo: string) {
  const [envio, company] = await Promise.all([
    prismaInstalacionA.envio.findUnique({
      where: { codigo: codigo.trim().toUpperCase() },
      include: { destino: { select: { codigo: true, nombre: true } }, items: { include: { package: { select: { code: true, destinatario: true, destinatarioTelefono: true } } } } },
    }),
    prismaInstalacionA.company.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  if (!envio || !['CERRADO', 'RECIBIDO'].includes(envio.estado)) return { ok: false as const, status: 404 };
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) return { ok: false as const, status: 403 };

  const dto: EnvioInteropDTO = {
    transferenciaId: envio.transferenciaId,
    codigo: envio.codigo,
    estado: envio.estado,
    origen: { codigo: company.sucursalCodigo, nombre: company.sucursalNombre },
    destino: { codigo: envio.destino.codigo, nombre: envio.destino.nombre },
    cantidadPaquetes: envio.items.length,
    paquetes: envio.items.map((it) => ({ codigo: it.package.code, destinatario: it.package.destinatario, destinatarioTelefono: it.package.destinatarioTelefono, estadoPago: it.estadoPago as 'PENDIENTE' | 'PAGADO', montoPagado: it.montoPagado })),
    cerradoAt: envio.cerradoAt ? envio.cerradoAt.toISOString() : null,
  };
  return { ok: true as const, dto };
}

/**
 * Réplica MÍNIMA de recibirEnvioParaInterop() (src/lib/interop-envios.ts)
 * — incluyendo la transición CERRADO -> RECIBIDO que normalmente hace
 * recibirEnvio() (src/lib/envios.ts) — parametrizada con el PrismaClient
 * de "instalación A" en vez del singleton compartido (ver limitación
 * documentada arriba). NUNCA crea Package: eso sigue siendo,
 * correctamente, responsabilidad exclusiva de "B" — igual que en la
 * función real.
 */
async function recibirEnAInstalacionA(codigo: string, sucursalSolicitanteCodigo: string, qrToken: string) {
  const envio = await prismaInstalacionA.envio.findUnique({
    where: { codigo: codigo.trim().toUpperCase() },
    select: { id: true, estado: true, qrToken: true, destino: { select: { codigo: true } } },
  });
  if (!envio) return { ok: false as const, status: 404 };
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) return { ok: false as const, status: 403 };
  if (envio.estado !== 'CERRADO' && envio.estado !== 'RECIBIDO') return { ok: false as const, status: 409 };
  if (!envio.qrToken || !compararTimingSafe(envio.qrToken, qrToken)) return { ok: false as const, status: 403 };

  if (envio.estado === 'CERRADO') {
    await prismaInstalacionA.envio.updateMany({ where: { id: envio.id, estado: 'CERRADO' }, data: { estado: 'RECIBIDO' } });
  }
  return resolverEnvioEnInstalacionA(codigo, sucursalSolicitanteCodigo);
}

beforeAll(async () => {
  // 1) Base de datos y PrismaClient PROPIOS de "instalación A" (La Paz) — un archivo SQLite físicamente distinto del de tests/setup.ts.
  execSync('npx prisma db push --skip-generate --force-reset --schema=./prisma/schema.prisma', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: dbUrlInstalacionA },
    stdio: 'ignore',
  });
  prismaInstalacionA = new PrismaClient({ datasourceUrl: dbUrlInstalacionA });

  await prismaInstalacionA.company.create({ data: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (instalación A de prueba)' } });
  const destinoEla = await prismaInstalacionA.sucursalDestino.create({ data: { codigo: 'ELA', nombre: 'Cofre Express El Alto', apiKeyEntrante: SECRETO_COMPARTIDO_ELA } });
  const branch = await prismaInstalacionA.branch.create({ data: { nombre: 'Sucursal de prueba (instalación A)' } });
  const user = await prismaInstalacionA.user.create({ data: { username: 'admin-a', passwordHash: 'x', nombre: 'Admin A', role: 'ADMIN', branchId: branch.id } });
  await prismaInstalacionA.packageSeries.create({ data: { inicial: 'W', descripcion: 'Prueba dos instalaciones' } });
  const pkg = await prismaInstalacionA.package.create({ data: { code: 'W1T-1', codigoNormalizado: 'W1T1', inicial: 'W', branchId: branch.id, status: 'EN_PAQUETERIA', registradoPorId: user.id } });
  const envio = await prismaInstalacionA.envio.create({ data: { codigo: 'ENV-DOS-INSTALACIONES-001', destinoId: destinoEla.id, estado: 'CERRADO', qrToken: 'qr-token-de-prueba', cerradoAt: new Date(), cerradoPorId: user.id } });
  await prismaInstalacionA.envioItem.create({ data: { envioId: envio.id, packageId: pkg.id, estadoPago: 'PAGADO', montoPagado: 5 } });
  codigoEnvioDePrueba = envio.codigo;

  // 2) Servidor HTTP real de "instalación A" — usa verificarFirmaInterop() REAL (nada mockeado).
  servidorInstalacionA = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const resultadoAuth = await verificarFirmaInterop({
        method: req.method ?? 'GET',
        path: url.pathname,
        body,
        headers: {
          sucursal: req.headers['x-cofre-sucursal'] as string | undefined,
          timestamp: req.headers['x-cofre-timestamp'] as string | undefined,
          nonce: req.headers['x-cofre-nonce'] as string | undefined,
          signature: req.headers['x-cofre-signature'] as string | undefined,
        },
        resolverSecreto: async (sucursalCodigo) => {
          const destino = await prismaInstalacionA.sucursalDestino.findUnique({ where: { codigo: sucursalCodigo } });
          return destino?.apiKeyEntrante ?? null;
        },
      });
      if (!resultadoAuth.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Autenticación inválida.' }));
        return;
      }

      const matchRecibir = url.pathname.match(/^\/api\/interop\/envios\/([^/]+)\/recibir$/);
      if (req.method === 'POST' && matchRecibir) {
        const codigo = matchRecibir[1] ? decodeURIComponent(matchRecibir[1]) : '';
        let qrToken = '';
        try {
          qrToken = JSON.parse(body)?.qrToken ?? '';
        } catch {
          // body invalido -> qrToken vacio, se rechaza mas abajo igual que la ruta real.
        }
        const recepcion = await recibirEnAInstalacionA(codigo, resultadoAuth.sucursalCodigo, qrToken);
        if (!recepcion.ok) {
          res.writeHead(recepcion.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No disponible.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(recepcion.dto));
        return;
      }

      const matchGet = url.pathname.match(/^\/api\/interop\/envios\/([^/]+)$/);
      const codigo = matchGet?.[1] ? decodeURIComponent(matchGet[1]) : '';
      const consulta = await resolverEnvioEnInstalacionA(codigo, resultadoAuth.sucursalCodigo);
      if (!consulta.ok) {
        res.writeHead(consulta.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No disponible.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(consulta.dto));
    });
  });

  await new Promise<void>((resolve) => servidorInstalacionA.listen(0, '127.0.0.1', resolve));
  const address = servidorInstalacionA.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo levantar el servidor de prueba de instalación A.');
  urlBaseInstalacionA = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidorInstalacionA.close(() => resolve()));
  await prismaInstalacionA.$disconnect();
  for (const sufijo of ['', '-journal', '-wal', '-shm']) {
    const p = dbPathInstalacionA + sufijo;
    if (existsSync(p)) rmSync(p);
  }
});

describe('Fase 4.3, punto 12 — dos instalaciones con SQLite realmente separadas', () => {
  test('B (El Alto) hace un GET firmado real a A (La Paz) por HTTP y recibe el DTO correcto', async () => {
    const dto = await consultarEnvioRemoto({
      apiUrlSaliente: urlBaseInstalacionA,
      codigo: codigoEnvioDePrueba,
      apiKeySaliente: SECRETO_COMPARTIDO_ELA, // el "apiKeySaliente" de B para hablarle a A == el "apiKeyEntrante" que A configuró para B
      sucursalCodigo: 'ELA',
    });

    expect(dto.codigo).toBe(codigoEnvioDePrueba);
    expect(dto.origen).toEqual({ codigo: 'LPZ', nombre: 'Cofre Express La Paz (instalación A de prueba)' });
    expect(dto.destino.codigo).toBe('ELA');
    expect(dto.paquetes).toEqual([{ codigo: 'W1T-1', destinatario: null, destinatarioTelefono: null, estadoPago: 'PAGADO', montoPagado: 5 }]);
  });

  test('la base de datos de B (la compartida de este proceso de tests) no cambió en absoluto por esta consulta', async () => {
    const antes = await Promise.all([prismaCompartidoDeTests.envio.count(), prismaCompartidoDeTests.package.count()]);

    await consultarEnvioRemoto({ apiUrlSaliente: urlBaseInstalacionA, codigo: codigoEnvioDePrueba, apiKeySaliente: SECRETO_COMPARTIDO_ELA, sucursalCodigo: 'ELA' });

    const despues = await Promise.all([prismaCompartidoDeTests.envio.count(), prismaCompartidoDeTests.package.count()]);
    expect(despues).toEqual(antes);
  });

  test('una firma inválida contra el servidor real de A también se rechaza (no es un artefacto del mock)', async () => {
    await expect(
      consultarEnvioRemoto({ apiUrlSaliente: urlBaseInstalacionA, codigo: codigoEnvioDePrueba, apiKeySaliente: 'secreto-equivocado', sucursalCodigo: 'ELA' })
    ).rejects.toThrow();
  });
});

describe('Fase 4.4, punto 14 — recepción remota + materialización, dos instalaciones reales', () => {
  test('B recibe el lote de A por HTTP real, materializa sus propios Package, y repetir el flujo completo (respuesta perdida) no duplica nada en ninguna de las dos bases', async () => {
    // Segundo envío en A, exclusivo de esta prueba (evita interferir con
    // el envío/paquete ya usado por el describe de Fase 4.3 arriba).
    const branchA = await prismaInstalacionA.branch.findFirstOrThrow();
    const userA = await prismaInstalacionA.user.findFirstOrThrow();
    const destinoElaA = await prismaInstalacionA.sucursalDestino.findFirstOrThrow({ where: { codigo: 'ELA' } });
    const pkgEnA = await prismaInstalacionA.package.create({
      data: { code: 'W3T-1', codigoNormalizado: 'W3T1', inicial: 'W', branchId: branchA.id, status: 'EN_PAQUETERIA', registradoPorId: userA.id, destinatario: 'María Pérez' },
    });
    const qrTokenPropio = 'qr-token-fase-4-4-dos-instalaciones';
    const envioAReceibir = await prismaInstalacionA.envio.create({
      data: { codigo: 'ENV-DOS-INSTALACIONES-RECIBIR-001', destinoId: destinoElaA.id, estado: 'CERRADO', qrToken: qrTokenPropio, cerradoAt: new Date(), cerradoPorId: userA.id },
    });
    await prismaInstalacionA.envioItem.create({ data: { envioId: envioAReceibir.id, packageId: pkgEnA.id, estadoPago: 'PENDIENTE', montoPagado: 0 } });

    // B necesita su propia PackageSeries y sucursal local activa para poder materializar (misma regla que Recepción normal).
    await prismaCompartidoDeTests.packageSeries.upsert({ where: { inicial: 'W' }, update: {}, create: { inicial: 'W', descripcion: 'Prueba dos instalaciones (materializados en B)' } });
    const branchExistenteEnB = await prismaCompartidoDeTests.branch.findFirst({ where: { activo: true } });
    if (!branchExistenteEnB) {
      await prismaCompartidoDeTests.branch.create({ data: { nombre: 'Sucursal de prueba (instalación B)' } });
    }

    async function flujoCompleto() {
      const dto = await recibirEnvioRemoto({
        apiUrlSaliente: urlBaseInstalacionA,
        codigo: envioAReceibir.codigo,
        qrToken: qrTokenPropio,
        apiKeySaliente: SECRETO_COMPARTIDO_ELA,
        sucursalCodigo: 'ELA',
      });
      return materializarRecepcionRemota({
        transferenciaId: dto.transferenciaId!,
        origenCodigo: dto.origen.codigo!,
        envioCodigoOrigen: dto.codigo,
        paquetes: dto.paquetes,
      });
    }

    const primerIntento = await flujoCompleto();
    expect(primerIntento).toEqual({ yaMaterializada: false, cantidadPaquetes: 1 });

    const pkgEnB = await prismaCompartidoDeTests.package.findUniqueOrThrow({
      where: { origenSucursalCodigo_origenCodigoPaquete: { origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'W3T-1' } },
    });
    expect(pkgEnB.id).not.toBe(pkgEnA.id); // registro PROPIO de B, nunca el mismo id que en A
    expect(pkgEnB.destinatario).toBe('María Pérez');
    expect(pkgEnB.status).toBe('EN_PAQUETERIA');
    expect(pkgEnB.origenSucursalCodigo).toBe('LPZ');
    expect(pkgEnB.origenCodigoPaquete).toBe('W3T-1');

    const envioEnADespuesDeRecibir = await prismaInstalacionA.envio.findUniqueOrThrow({ where: { id: envioAReceibir.id } });
    expect(envioEnADespuesDeRecibir.estado).toBe('RECIBIDO'); // A = una sola recepción

    // "La respuesta de A se pierde antes de llegar a B" -- B reintenta el FLUJO COMPLETO desde cero.
    const antesDelReintento = await prismaCompartidoDeTests.package.count();
    const reintento = await flujoCompleto();
    expect(reintento.yaMaterializada).toBe(true);
    const despuesDelReintento = await prismaCompartidoDeTests.package.count();
    expect(despuesDelReintento).toBe(antesDelReintento); // B = una sola copia del Package, nunca dos

    const envioEnADespuesDelReintento = await prismaInstalacionA.envio.findUniqueOrThrow({ where: { id: envioAReceibir.id } });
    expect(envioEnADespuesDelReintento.estado).toBe('RECIBIDO'); // A sigue siendo una sola recepción real
  });
});
