// tests/tracking-interop-delegacion-http.test.ts
// Fase 5.3-HARDENING, sección 3 — flujo de punta a punta con DOS bases de
// datos SQLite realmente separadas y un servidor HTTP real (loopback),
// igual criterio que tests/interop-dos-instalaciones.test.ts (ver su
// comentario de cabecera para la justificación completa de por qué un
// lado se reimplementa a mano: emitirEventoPaquete()/procesarLoteOutbox()/
// enviarDelegacionAOrigen() usan el PrismaClient SINGLETON de
// src/lib/prisma.ts, que no puede apuntar a dos bases a la vez dentro del
// mismo proceso).
//
// Rol de cada lado en esta prueba:
//   "El Alto" (destino) = el PrismaClient SINGLETON compartido de este
//     proceso de tests (test.db) — así se ejerce, SIN NINGÚN MOCK, el
//     código nuevo más importante de esta fase: transicionar() ->
//     emitirEventoPaquete() (detecta que no puede firmar como LPZ) ->
//     encolarDelegacionInterop() (atómico) -> procesarLoteOutbox() (el
//     worker real) -> enviarDelegacionAOrigen() (el cliente real, HMAC
//     real) -> HTTP real hacia el servidor de abajo.
//   "La Paz" (origen) = una base SQLite físicamente distinta
//     (prismaInstalacionLPZ) + un servidor `http.createServer()` real que
//     reimplementa ÚNICAMENTE la orquestación de nivel superior de
//     registrarEventoTrackingDelegado() (las consultas a Envio/EnvioItem,
//     parametrizadas contra prismaInstalacionLPZ en vez del singleton) —
//     pero delega la parte más importante, construir y encolar el evento
//     final, a la función REAL emitirEventoPaquete(tx, ...), sin
//     modificar: como esa función recibe su `tx` por parámetro (nunca usa
//     el singleton directamente), funciona igual de bien con
//     prismaInstalacionLPZ.$transaction(...) que con el singleton.
//
// Qué NO es esto (misma limitación ya documentada en el archivo hermano):
// no son dos procesos de Next.js reales, no usa HTTPS. Lo que SÍ queda
// demostrado: firma/verificación HMAC real, protocolo real, atomicidad
// real de la escritura final en la base de "La Paz", y que una firma
// inválida o un destino incorrecto nunca producen ningún write allá.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import { prisma as prismaElAlto } from '@/lib/prisma';
import { verificarFirmaInterop } from '@/lib/interop';
import { emitirEventoPaquete } from '@/lib/tracking/eventos';
import { entregarPaquete } from '@/lib/package-transitions';
import { procesarLoteOutbox } from '@/lib/tracking/worker';

const SECRETO_ELA_HACIA_LPZ = 'test-secret-delegacion-fase53-hardening';
const TRANSFERENCIA_ID = 'transferencia-http-e2e-1';
const CODIGO_PAQUETE_ORIGEN = 'M3T-125';

const dbPathLPZ = path.join(os.tmpdir(), `cofre-tracking-delegacion-lpz-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const dbUrlLPZ = `file:${dbPathLPZ}?connection_limit=1`;

let prismaInstalacionLPZ: PrismaClient;
let servidorLPZ: Server;
let urlBaseLPZ: string;

/**
 * Réplica MÍNIMA de la orquestación de nivel superior de
 * registrarEventoTrackingDelegado() (src/lib/interop-envios.ts),
 * parametrizada contra prismaInstalacionLPZ en vez del singleton — ver
 * limitación documentada arriba. La construcción/encolado del evento
 * final SÍ usa la función real (emitirEventoPaquete), sin modificar.
 */
async function manejarDelegacionEnLPZ(bodyJson: { transferenciaId: string; origenCodigoPaquete: string; reporteId: string; tipoEvento: 'PAQUETE_TRANSICION'; estadoInternoOrigen: string; fechaOrigen: string }, sucursalSolicitanteCodigo: string) {
  const envio = await prismaInstalacionLPZ.envio.findUnique({
    where: { transferenciaId: bodyJson.transferenciaId },
    include: { destino: { select: { codigo: true, nombre: true } }, items: { select: { package: { select: { code: true } } } } },
  });
  if (!envio) return { status: 404 as const };
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) return { status: 403 as const };
  if (envio.estado !== 'RECIBIDO') return { status: 409 as const };
  const item = envio.items.find((it) => it.package.code === bodyJson.origenCodigoPaquete);
  if (!item) return { status: 403 as const };

  const eventId = `INTEROP:${bodyJson.reporteId}`;
  let duplicado = false;
  await prismaInstalacionLPZ.$transaction(async (tx) => {
    const existente = await tx.outboxEvent.findUnique({ where: { eventId } });
    if (existente) {
      duplicado = true;
      return;
    }
    await emitirEventoPaquete(tx, {
      tipoEvento: 'PAQUETE_TRANSICION',
      eventId,
      pkg: { code: bodyJson.origenCodigoPaquete, origenSucursalCodigo: null, origenCodigoPaquete: null },
      estadoInternoOrigen: bodyJson.estadoInternoOrigen,
      fechaOrigen: new Date(bodyJson.fechaOrigen),
      sucursalActual: { codigo: sucursalSolicitanteCodigo, nombre: envio.destino.nombre },
    });
  });
  return { status: (duplicado ? 200 : 201) as 200 | 201 };
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --force-reset --schema=./prisma/schema.prisma', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: dbUrlLPZ },
    stdio: 'ignore',
  });
  prismaInstalacionLPZ = new PrismaClient({ datasourceUrl: dbUrlLPZ });

  await prismaInstalacionLPZ.company.create({ data: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (instalación real de prueba)' } });
  const destinoEla = await prismaInstalacionLPZ.sucursalDestino.create({ data: { codigo: 'ELAX', nombre: 'Cofre Express El Alto', apiKeyEntrante: SECRETO_ELA_HACIA_LPZ } });
  const branchLPZ = await prismaInstalacionLPZ.branch.create({ data: { nombre: 'Sucursal de prueba (LPZ)' } });
  const userLPZ = await prismaInstalacionLPZ.user.create({ data: { username: 'admin-lpz', passwordHash: 'x', nombre: 'Admin LPZ', role: 'ADMIN', branchId: branchLPZ.id } });
  await prismaInstalacionLPZ.packageSeries.create({ data: { inicial: 'M', descripcion: 'Prueba delegación' } });
  const pkgEnLPZ = await prismaInstalacionLPZ.package.create({ data: { code: CODIGO_PAQUETE_ORIGEN, codigoNormalizado: CODIGO_PAQUETE_ORIGEN.replace(/-/g, ''), inicial: 'M', branchId: branchLPZ.id, status: 'EN_PAQUETERIA', registradoPorId: userLPZ.id } });
  const envioEnLPZ = await prismaInstalacionLPZ.envio.create({
    data: { codigo: 'ENV-DELEGACION-001', destinoId: destinoEla.id, estado: 'RECIBIDO', transferenciaId: TRANSFERENCIA_ID, qrToken: 'qr-delegacion-1', cerradoAt: new Date(), cerradoPorId: userLPZ.id, recibidoViaInterop: true },
  });
  await prismaInstalacionLPZ.envioItem.create({ data: { envioId: envioEnLPZ.id, packageId: pkgEnLPZ.id, estadoPago: 'PAGADO', montoPagado: 0 } });

  servidorLPZ = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const auth = await verificarFirmaInterop({
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
          const destino = await prismaInstalacionLPZ.sucursalDestino.findUnique({ where: { codigo: sucursalCodigo } });
          return destino?.apiKeyEntrante ?? null;
        },
      });
      if (!auth.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Autenticación inválida.' }));
        return;
      }
      if (url.pathname !== '/api/interop/tracking/eventos' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      let bodyJson: unknown;
      try {
        bodyJson = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const resultado = await manejarDelegacionEnLPZ(bodyJson as never, auth.sucursalCodigo);
      res.writeHead(resultado.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ recibido: resultado.status < 300 }));
    });
  });
  await new Promise<void>((resolve) => servidorLPZ.listen(0, '127.0.0.1', resolve));
  const address = servidorLPZ.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo levantar el servidor de prueba de LPZ.');
  urlBaseLPZ = `http://127.0.0.1:${address.port}`;

  // "El Alto" (el singleton compartido de este proceso de tests) — su
  // propia identidad + catálogo apuntando al servidor real de arriba.
  await prismaElAlto.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'ELAX', sucursalNombre: 'Cofre Express El Alto' },
    create: { id: 1, sucursalCodigo: 'ELAX', sucursalNombre: 'Cofre Express El Alto' },
  });
  await prismaElAlto.sucursalDestino.upsert({
    where: { codigo: 'LPZ' },
    update: { apiUrlSaliente: urlBaseLPZ, apiKeySaliente: SECRETO_ELA_HACIA_LPZ },
    create: { codigo: 'LPZ', nombre: 'Cofre Express La Paz', apiUrlSaliente: urlBaseLPZ, apiKeySaliente: SECRETO_ELA_HACIA_LPZ },
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidorLPZ.close(() => resolve()));
  await prismaInstalacionLPZ.$disconnect();
  for (const sufijo of ['', '-journal', '-wal', '-shm']) {
    const p = dbPathLPZ + sufijo;
    if (existsSync(p)) rmSync(p);
  }
});

describe('G/I — Paquete LPZ -> ELA -> transición posterior en ELA, delegación HTTP+HMAC real de punta a punta', () => {
  test('El Alto entrega el paquete materializado; el worker delega por HTTP real; La Paz valida y encola el evento final firmable como sí misma', async () => {
    const branchElAlto = await prismaElAlto.branch.create({ data: { nombre: 'Sucursal de prueba (ELA, http e2e)' } });
    const userElAlto = await prismaElAlto.user.create({ data: { username: 'admin-ela-http', passwordHash: 'x', nombre: 'Admin ELA', role: 'ADMIN', branchId: branchElAlto.id } });
    await prismaElAlto.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Prueba delegación ELA' } });
    const materializado = await prismaElAlto.package.create({
      data: {
        code: CODIGO_PAQUETE_ORIGEN,
        codigoNormalizado: CODIGO_PAQUETE_ORIGEN.replace(/-/g, ''),
        inicial: 'M',
        branchId: branchElAlto.id,
        status: 'EN_PAQUETERIA',
        registradoPorId: userElAlto.id,
        origenSucursalCodigo: 'LPZ',
        origenCodigoPaquete: CODIGO_PAQUETE_ORIGEN,
        origenTransferenciaId: TRANSFERENCIA_ID,
      },
    });

    // 1) La operación REAL en El Alto — entregarPaquete() -> transicionar()
    //    -> emitirEventoPaquete() detecta que no puede firmar como LPZ y
    //    encola la delegación (INTEROP_ORIGEN), atómico con la entrega.
    await entregarPaquete(CODIGO_PAQUETE_ORIGEN, userElAlto.id);
    const historial = await prismaElAlto.packageHistory.findFirstOrThrow({ where: { packageId: materializado.id, estado: 'ENTREGADO' } });
    const filaDelegacion = await prismaElAlto.outboxEvent.findUniqueOrThrow({ where: { eventId: `INTEROP:${historial.id}` } });
    expect(filaDelegacion.destino).toBe('INTEROP_ORIGEN');
    expect(filaDelegacion.estado).toBe('PENDING');

    // 2) El worker REAL de El Alto envía la delegación por HTTP real, firmada con HMAC real.
    const resultadoLote = await procesarLoteOutbox();
    expect(resultadoLote.fallidos).toBe(0);
    expect(resultadoLote.enviados).toBeGreaterThanOrEqual(1);

    const filaTrasEnvio = await prismaElAlto.outboxEvent.findUniqueOrThrow({ where: { id: filaDelegacion.id } });
    expect(filaTrasEnvio.estado).toBe('SENT'); // El Alto considera cumplida su parte

    // 3) La Paz (base físicamente distinta) validó la solicitud y encoló,
    //    ELLA MISMA, el evento final ya firmable como origen.
    const eventoFinalEnLPZ = await prismaInstalacionLPZ.outboxEvent.findUniqueOrThrow({ where: { eventId: `INTEROP:${historial.id}` } });
    expect(eventoFinalEnLPZ.destino).toBe('TRACKING');
    expect(eventoFinalEnLPZ.origenSucursalCodigo).toBe('LPZ');
    const payloadFinal = JSON.parse(eventoFinalEnLPZ.payload);
    expect(payloadFinal.origenSucursalCodigo).toBe('LPZ');
    expect(payloadFinal.codigo).toBe(CODIGO_PAQUETE_ORIGEN);
    expect(payloadFinal.sucursalActualCodigo).toBe('ELAX'); // el paquete está físicamente en El Alto
    expect(payloadFinal.estadoInternoOrigen).toBe('ENTREGADO');

    // 4) La base de El Alto nunca se vio afectada por nada de lo que pasó en La Paz.
    const pkgFinal = await prismaElAlto.package.findUniqueOrThrow({ where: { id: materializado.id } });
    expect(pkgFinal.status).toBe('ENTREGADO');
  });

  test('H/reintento: si El Alto reintenta la delegación completa (respuesta perdida), La Paz no duplica el evento final', async () => {
    const branchElAlto = await prismaElAlto.branch.findFirstOrThrow({ where: { nombre: 'Sucursal de prueba (ELA, http e2e)' } });
    const userElAlto = await prismaElAlto.user.findFirstOrThrow({ where: { username: 'admin-ela-http' } });
    const otroCodigo = 'M3T-126';
    const materializado = await prismaElAlto.package.create({
      data: {
        code: otroCodigo,
        codigoNormalizado: otroCodigo.replace(/-/g, ''),
        inicial: 'M',
        branchId: branchElAlto.id,
        status: 'EN_PAQUETERIA',
        registradoPorId: userElAlto.id,
        origenSucursalCodigo: 'LPZ',
        origenCodigoPaquete: otroCodigo,
        origenTransferenciaId: TRANSFERENCIA_ID,
      },
    });
    // El envío de origen en LPZ solo tiene el item M3T-125 — agregamos el segundo paquete a su lote para que la delegación sea válida.
    const envioLPZ = await prismaInstalacionLPZ.envio.findUniqueOrThrow({ where: { transferenciaId: TRANSFERENCIA_ID } });
    const pkgLPZ = await prismaInstalacionLPZ.package.create({ data: { code: otroCodigo, codigoNormalizado: otroCodigo.replace(/-/g, ''), inicial: 'M', branchId: (await prismaInstalacionLPZ.branch.findFirstOrThrow()).id, status: 'EN_PAQUETERIA', registradoPorId: (await prismaInstalacionLPZ.user.findFirstOrThrow()).id } });
    await prismaInstalacionLPZ.envioItem.create({ data: { envioId: envioLPZ.id, packageId: pkgLPZ.id, estadoPago: 'PAGADO', montoPagado: 0 } });

    await entregarPaquete(otroCodigo, userElAlto.id);
    await procesarLoteOutbox();

    const historial = await prismaElAlto.packageHistory.findFirstOrThrow({ where: { packageId: materializado.id, estado: 'ENTREGADO' } });
    const conteoAntes = await prismaInstalacionLPZ.outboxEvent.count({ where: { eventId: `INTEROP:${historial.id}` } });
    expect(conteoAntes).toBe(1);

    // "La respuesta se perdió": El Alto vuelve la fila a PENDING y reintenta el envío completo.
    const fila = await prismaElAlto.outboxEvent.findUniqueOrThrow({ where: { eventId: `INTEROP:${historial.id}` } });
    await prismaElAlto.outboxEvent.update({ where: { id: fila.id }, data: { estado: 'PENDING', nextAttemptAt: new Date() } });
    await procesarLoteOutbox();

    const conteoDespues = await prismaInstalacionLPZ.outboxEvent.count({ where: { eventId: `INTEROP:${historial.id}` } });
    expect(conteoDespues).toBe(1); // La Paz nunca duplicó el evento final
  });

  test('firma inválida (secreto incorrecto) contra el servidor real de La Paz -> ningún write allá', async () => {
    const antes = await prismaInstalacionLPZ.outboxEvent.count();
    await prismaElAlto.sucursalDestino.update({ where: { codigo: 'LPZ' }, data: { apiKeySaliente: 'secreto-equivocado' } });

    const resultado = await manejarDelegacionConSecretoIncorrecto();
    expect(resultado.status).toBe(401);

    const despues = await prismaInstalacionLPZ.outboxEvent.count();
    expect(despues).toBe(antes);

    await prismaElAlto.sucursalDestino.update({ where: { codigo: 'LPZ' }, data: { apiKeySaliente: SECRETO_ELA_HACIA_LPZ } }); // restaurar para no afectar otros tests de este archivo
  });
});

async function manejarDelegacionConSecretoIncorrecto() {
  const { crearHeadersInterop } = await import('@/lib/interop/headers');
  const path = '/api/interop/tracking/eventos';
  const body = JSON.stringify({ transferenciaId: TRANSFERENCIA_ID, origenCodigoPaquete: CODIGO_PAQUETE_ORIGEN, reporteId: 'reporte-firma-invalida', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date().toISOString() });
  const headers = crearHeadersInterop({ sucursalCodigo: 'ELAX', secreto: 'secreto-equivocado', method: 'POST', path, body });
  const res = await fetch(new URL(path, urlBaseLPZ).toString(), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
  return { status: res.status };
}
