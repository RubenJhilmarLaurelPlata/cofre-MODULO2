// tests/interop-recibir.test.ts
// Fase 4.4: primera operación de escritura real entre instalaciones —
// POST /api/interop/envios/[codigo]/recibir (lado ORIGEN, ejecuta
// recibirEnvio() real) + materializarRecepcionRemota() (lado DESTINO,
// crea Package/PackageHistory/EnvioRecepcionRemota PROPIOS). Contra
// SQLite real de prueba (ver tests/setup.ts), invocando las funciones y
// el route.ts reales — sin mockear cripto ni Prisma. Secretos ficticios.
import { describe, test, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { crearHeadersInterop } from '@/lib/interop';
import { crearEnvio, agregarPaquete, cerrarEnvio, recibirEnvio } from '@/lib/envios';
import { materializarRecepcionRemota, recibirEnvioParaInterop, getEnvioParaInterop } from '@/lib/interop-envios';
import { SerieNoConfiguradaError } from '@/lib/paquete-registro';
import { entregarPaquete, PaqueteEnEnvioError } from '@/lib/package-transitions';
import { POST } from '@/app/api/interop/envios/[codigo]/recibir/route';

const SECRETO_ELA = 'test-secret-el-alto-recibir';
const SECRETO_ORU = 'test-secret-oruro-recibir';

let userId: string;
let branchId: string;
let destinoElaId: string;
let seq = 0;

async function crearPaqueteDePrueba(): Promise<string> {
  seq++;
  const inicial = 'V';
  await prisma.packageSeries.upsert({ where: { inicial }, update: {}, create: { inicial, descripcion: 'Prueba interop recibir' } });
  const code = `V1T-${seq}`;
  const pkg = await prisma.package.create({ data: { code, codigoNormalizado: code.replace(/-/g, ''), inicial, branchId, status: 'EN_PAQUETERIA', registradoPorId: userId } });
  return pkg.code;
}

/** Crea un envío CERRADO real (crearEnvio -> agregarPaquete -> cerrarEnvio) y devuelve su código y qrToken reales. */
async function crearEnvioCerradoDePrueba(): Promise<{ codigo: string; qrToken: string; id: string }> {
  const codigoPaquete = await crearPaqueteDePrueba();
  const envio = await crearEnvio(destinoElaId, userId);
  await agregarPaquete(envio.id, codigoPaquete, userId);
  const cerrado = await cerrarEnvio(envio.id, userId);
  if (!cerrado.qrToken) throw new Error('cerrarEnvio() no generó qrToken — no debería pasar nunca.');
  return { codigo: cerrado.codigo, qrToken: cerrado.qrToken, id: cerrado.id };
}

function construirRequestFirmado(secreto: string, sucursalCodigo: string, path: string, body: string, opts?: { nonce?: string; signatureOverride?: string }): NextRequest {
  const headers = crearHeadersInterop({ sucursalCodigo, secreto, method: 'POST', path, body, nonce: opts?.nonce });
  if (opts?.signatureOverride !== undefined) headers['X-Cofre-Signature'] = opts.signatureOverride;
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
}

beforeAll(async () => {
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
  });
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba interop-recibir' } });
  branchId = branch.id;
  const user = await prisma.user.create({ data: { username: 'admin-interop-recibir-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId } });
  userId = user.id;

  const destinoEla = await prisma.sucursalDestino.create({ data: { codigo: 'ELA', nombre: 'Cofre Express El Alto', apiKeyEntrante: SECRETO_ELA } });
  destinoElaId = destinoEla.id;
  await prisma.sucursalDestino.create({ data: { codigo: 'ORU', nombre: 'Cofre Express Oruro', apiKeyEntrante: SECRETO_ORU } });
});

describe('Fase 4.4 — POST /api/interop/envios/[codigo]/recibir (lado ORIGEN)', () => {
  test('1) y 7) POST válido con qrToken correcto -> 200, recepción exitosa (Envio.estado pasa a RECIBIDO)', async () => {
    const { codigo, qrToken, id } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body);

    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(200);
    const dto = await res.json();
    expect(dto.codigo).toBe(codigo);
    expect(dto.estado).toBe('RECIBIDO');

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('RECIBIDO');
  });

  test('b) recepción remota: Envio queda RECIBIDO con recibidoViaInterop=true, y el paquete de ORIGEN deja de estar disponible para entrega local', async () => {
    const codigoPaquete = await crearPaqueteDePrueba();
    const { codigo, qrToken, id } = await (async () => {
      const envio = await crearEnvio(destinoElaId, userId);
      await agregarPaquete(envio.id, codigoPaquete, userId);
      const cerrado = await cerrarEnvio(envio.id, userId);
      return { codigo: cerrado.codigo, qrToken: cerrado.qrToken!, id: cerrado.id };
    })();

    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const res = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body), { params: { codigo } });
    expect(res.status).toBe(200);

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('RECIBIDO');
    expect(envioEnDb.recibidoViaInterop).toBe(true);

    // El paquete de ORIGEN ya no debe poder entregarse/procesarse aquí —
    // físicamente se fue a una base de datos separada (el destino).
    await expect(entregarPaquete(codigoPaquete, userId)).rejects.toThrow(PaqueteEnEnvioError);
  });

  test('recepción LOCAL (recibidoViaInterop=false) del mismo tipo de envío SÍ sigue permitiendo la entrega local (contraste directo con el caso remoto de arriba)', async () => {
    const codigoPaquete = await crearPaqueteDePrueba();
    const envio = await crearEnvio(destinoElaId, userId);
    await agregarPaquete(envio.id, codigoPaquete, userId);
    await cerrarEnvio(envio.id, userId);
    await recibirEnvio(envio.id, userId); // recepción LOCAL — recibidoViaInterop queda false por defecto

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id: envio.id } });
    expect(envioEnDb.recibidoViaInterop).toBe(false);

    await expect(entregarPaquete(codigoPaquete, userId)).resolves.toBeDefined();
  });

  test('si el envío ya fue RECIBIDO LOCALMENTE, una solicitud remota posterior (con el qrToken correcto) se rechaza en vez de reconciliarse en silencio', async () => {
    const codigoPaquete = await crearPaqueteDePrueba();
    const envio = await crearEnvio(destinoElaId, userId);
    await agregarPaquete(envio.id, codigoPaquete, userId);
    const cerrado = await cerrarEnvio(envio.id, userId);
    await recibirEnvio(envio.id, userId); // recepción LOCAL primero

    const path = `/api/interop/envios/${cerrado.codigo}/recibir`;
    const body = JSON.stringify({ qrToken: cerrado.qrToken });
    const res = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body), { params: { codigo: cerrado.codigo } });

    expect(res.status).toBe(409);
    // recibidoViaInterop nunca se "sube" a true en silencio.
    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id: envio.id } });
    expect(envioEnDb.recibidoViaInterop).toBe(false);
  });

  test('2) QR token incorrecto (firma válida, sucursal correcta) -> 403, sin revelar el motivo exacto', async () => {
    const { codigo } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken: 'token-completamente-inventado' });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body);

    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(403);
  });

  test('3) lote inexistente -> 404', async () => {
    const path = '/api/interop/envios/ENV-NO-EXISTE-999/recibir';
    const body = JSON.stringify({ qrToken: 'cualquiera' });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body);
    const res = await POST(req, { params: { codigo: 'ENV-NO-EXISTE-999' } });
    expect(res.status).toBe(404);
  });

  test('4) sucursal no autorizada (desconocida) -> 401', async () => {
    const { codigo, qrToken } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const req = construirRequestFirmado('cualquier-secreto', 'NOEXISTE', path, body);
    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(401);
  });

  test('5) destino incorrecto: sucursal real y autenticada, pero el envío es para OTRA sucursal -> 403 (incluso con el qrToken correcto)', async () => {
    const { codigo, qrToken } = await crearEnvioCerradoDePrueba(); // destino real: ELA
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const req = construirRequestFirmado(SECRETO_ORU, 'ORU', path, body); // ORU se autentica correctamente, pero no es el destino
    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(403);
  });

  test('6) lote en estado inválido (BORRADOR, nunca cerrado) -> 409', async () => {
    const codigoPaquete = await crearPaqueteDePrueba();
    const envio = await crearEnvio(destinoElaId, userId);
    await agregarPaquete(envio.id, codigoPaquete, userId); // nunca se cierra

    const path = `/api/interop/envios/${envio.codigo}/recibir`;
    const body = JSON.stringify({ qrToken: 'no-existe-todavia' });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body);
    const res = await POST(req, { params: { codigo: envio.codigo } });
    expect(res.status).toBe(409);
  });

  test('8) segunda recepción de la MISMA transferencia es idempotente: 200 de nuevo, mismo resultado, sin re-ejecutar nada destructivo', async () => {
    const { codigo, qrToken, id } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });

    const res1 = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body, { nonce: 'nonce-recibir-idem-1' }), { params: { codigo } });
    expect(res1.status).toBe(200);
    const dto1 = await res1.json();

    const res2 = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body, { nonce: 'nonce-recibir-idem-2' }), { params: { codigo } });
    expect(res2.status).toBe(200);
    const dto2 = await res2.json();

    expect(dto2).toEqual(dto1); // mismo resultado exacto, no un segundo estado distinto
    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('RECIBIDO'); // nunca "RECIBIDO otra vez" ni ningún estado raro
  });

  test('9) dos recepciones SIMULTÁNEAS de la misma transferencia: ambas resuelven 200, el envío queda RECIBIDO exactamente una vez', async () => {
    const { codigo, qrToken, id } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });

    const [res1, res2] = await Promise.all([
      POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body, { nonce: 'nonce-recibir-concurrente-1' }), { params: { codigo } }),
      POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body, { nonce: 'nonce-recibir-concurrente-2' }), { params: { codigo } }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('RECIBIDO');

    const eventosDeRecepcion = await prisma.auditLog.count({ where: { accion: 'ENVIO_RECIBIDO', valorNuevo: { contains: codigo } } });
    expect(eventosDeRecepcion).toBe(1); // la transición real ocurrió UNA sola vez, nunca dos
  });

  test('17) los secretos nunca aparecen en ninguna respuesta', async () => {
    const { codigo, qrToken } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const res = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body), { params: { codigo } });
    const crudo = await res.text();
    expect(crudo).not.toContain(SECRETO_ELA);
    expect(crudo.toLowerCase()).not.toContain('apikey');
  });

  test('18) el qrToken nunca aparece en la respuesta de recepción exitosa', async () => {
    const { codigo, qrToken } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const res = await POST(construirRequestFirmado(SECRETO_ELA, 'ELA', path, body), { params: { codigo } });
    const dto = await res.json();
    expect('qrToken' in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain(qrToken);
  });

  test('19) ninguna escritura ocurre si falla la firma HMAC (Envio sigue CERRADO)', async () => {
    const { codigo, qrToken, id } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body, { signatureOverride: 'f'.repeat(64) });

    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(401);

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('CERRADO'); // nunca cambió
  });

  test('20) ninguna escritura ocurre si falla la validación del QR (Envio sigue CERRADO)', async () => {
    const { codigo, id } = await crearEnvioCerradoDePrueba();
    const path = `/api/interop/envios/${codigo}/recibir`;
    const body = JSON.stringify({ qrToken: 'token-incorrecto' });
    const req = construirRequestFirmado(SECRETO_ELA, 'ELA', path, body);

    const res = await POST(req, { params: { codigo } });
    expect(res.status).toBe(403);

    const envioEnDb = await prisma.envio.findUniqueOrThrow({ where: { id } });
    expect(envioEnDb.estado).toBe('CERRADO'); // nunca cambió
  });
});

describe('Fase 4.4 — materializarRecepcionRemota() (lado DESTINO)', () => {
  test('10), 12), 13) crea un Package propio con origenSucursalCodigo/origenCodigoPaquete/origenTransferenciaId correctos', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Materializados' } });
    const transferenciaId = `transferencia-materializar-${Date.now()}`;

    const resultado = await materializarRecepcionRemota({
      transferenciaId,
      origenCodigo: 'LPZ',
      envioCodigoOrigen: 'ENV-20260904-777',
      paquetes: [{ codigo: 'M24J-500', destinatario: 'Juan Pérez', destinatarioTelefono: '70000000', estadoPago: 'PAGADO', montoPagado: 15 }],
    });

    expect(resultado).toEqual({ yaMaterializada: false, cantidadPaquetes: 1 });

    const pkg = await prisma.package.findUniqueOrThrow({ where: { origenSucursalCodigo_origenCodigoPaquete: { origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-500' } } });
    expect(pkg.code).toBe('M24J-500');
    expect(pkg.status).toBe('EN_PAQUETERIA');
    expect(pkg.destinatario).toBe('Juan Pérez');
    expect(pkg.origenSucursalCodigo).toBe('LPZ');
    expect(pkg.origenCodigoPaquete).toBe('M24J-500');
    expect(pkg.origenTransferenciaId).toBe(transferenciaId);
  });

  test('14) crea una fila de PackageHistory correcta al materializar', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Materializados' } });
    const transferenciaId = `transferencia-historial-${Date.now()}`;

    await materializarRecepcionRemota({
      transferenciaId,
      origenCodigo: 'LPZ',
      envioCodigoOrigen: 'ENV-20260904-778',
      paquetes: [{ codigo: 'M24J-501', destinatario: null, destinatarioTelefono: null, estadoPago: 'PENDIENTE', montoPagado: 0 }],
    });

    const pkg = await prisma.package.findUniqueOrThrow({ where: { origenSucursalCodigo_origenCodigoPaquete: { origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-501' } } });
    const historial = await prisma.packageHistory.findMany({ where: { packageId: pkg.id } });
    expect(historial).toHaveLength(1);
    expect(historial[0]?.estado).toBe('EN_PAQUETERIA');
    expect(historial[0]?.nota).toContain('LPZ');
  });

  test('11) y 21) llamar dos veces con la MISMA transferenciaId nunca duplica el Package (idempotente por transferenciaId)', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Materializados' } });
    const transferenciaId = `transferencia-duplicado-${Date.now()}`;
    const input = {
      transferenciaId,
      origenCodigo: 'LPZ',
      envioCodigoOrigen: 'ENV-20260904-779',
      paquetes: [{ codigo: 'M24J-502', destinatario: null, destinatarioTelefono: null, estadoPago: 'PENDIENTE' as const, montoPagado: 0 }],
    };

    const antes = await prisma.package.count();
    const primera = await materializarRecepcionRemota(input);
    expect(primera.yaMaterializada).toBe(false);
    const despuesPrimera = await prisma.package.count();
    expect(despuesPrimera).toBe(antes + 1);

    const segunda = await materializarRecepcionRemota(input);
    expect(segunda.yaMaterializada).toBe(true);
    const despuesSegunda = await prisma.package.count();
    expect(despuesSegunda).toBe(despuesPrimera); // ni un Package más
  });

  test('9b) dos materializaciones SIMULTÁNEAS de la misma transferencia nunca terminan en dos EnvioRecepcionRemota', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Materializados' } });
    const transferenciaId = `transferencia-concurrente-${Date.now()}`;
    const input = {
      transferenciaId,
      origenCodigo: 'LPZ',
      envioCodigoOrigen: 'ENV-20260904-780',
      paquetes: [{ codigo: 'M24J-503', destinatario: null, destinatarioTelefono: null, estadoPago: 'PENDIENTE' as const, montoPagado: 0 }],
    };

    const [a, b] = await Promise.all([materializarRecepcionRemota(input), materializarRecepcionRemota(input)]);
    // Exactamente una de las dos hizo el trabajo real, la otra reconoció que ya estaba hecho.
    expect([a.yaMaterializada, b.yaMaterializada].sort()).toEqual([false, true]);

    const registros = await prisma.envioRecepcionRemota.count({ where: { transferenciaId } });
    expect(registros).toBe(1);
    const paquetesConEsteCodigo = await prisma.package.count({ where: { origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-503' } });
    expect(paquetesConEsteCodigo).toBe(1);
  });

  test('15) rollback completo si falla la materialización de un paquete del lote (ninguno queda a medio crear)', async () => {
    // 'Z9' deliberadamente SIN PackageSeries configurada en esta instalación.
    await prisma.packageSeries.upsert({ where: { inicial: 'M' }, update: {}, create: { inicial: 'M', descripcion: 'Materializados' } });
    const transferenciaId = `transferencia-rollback-${Date.now()}`;
    const input = {
      transferenciaId,
      origenCodigo: 'LPZ',
      envioCodigoOrigen: 'ENV-20260904-781',
      paquetes: [
        { codigo: 'M24J-504', destinatario: null, destinatarioTelefono: null, estadoPago: 'PENDIENTE' as const, montoPagado: 0 },
        { codigo: 'Z9X-999', destinatario: null, destinatarioTelefono: null, estadoPago: 'PENDIENTE' as const, montoPagado: 0 }, // esta va a fallar
      ],
    };

    await expect(materializarRecepcionRemota(input)).rejects.toBeInstanceOf(SerieNoConfiguradaError);

    // NINGUNO de los dos quedó creado — ni siquiera el primero, que sí era válido.
    const primero = await prisma.package.findUnique({ where: { origenSucursalCodigo_origenCodigoPaquete: { origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-504' } } });
    expect(primero).toBeNull();
    const registro = await prisma.envioRecepcionRemota.findUnique({ where: { transferenciaId } });
    expect(registro).toBeNull(); // tampoco quedó el registro de idempotencia — un reintento posterior puede procesar desde cero

    // Y un reintento posterior (ya con el problema resuelto: quitamos el paquete problemático) sí puede completarse.
    const reintento = await materializarRecepcionRemota({ ...input, paquetes: [input.paquetes[0]!] });
    expect(reintento).toEqual({ yaMaterializada: false, cantidadPaquetes: 1 });
  });
  // 16) "respuesta perdida / reintento" con el flujo COMPLETO (POST
  // /recibir real + materializar) requiere dos bases de datos realmente
  // separadas — en una sola base compartida, el código del paquete de
  // origen SIEMPRE colisionaría consigo mismo al "materializarse" en la
  // misma tabla (confirma, de hecho, por qué la identidad origen+código
  // importa). Se prueba con dos instalaciones reales en
  // tests/interop-dos-instalaciones.test.ts, no aquí.
});
