// tests/interop-envios-route.test.ts
// Fase 4.3: primer endpoint real de interoperabilidad — GET
// /api/interop/envios/[codigo], SOLO LECTURA. Contra SQLite real de
// prueba (ver tests/setup.ts), invocando el propio route.ts (la función
// GET real, importada tal cual) con un NextRequest real construido con
// crearHeadersInterop() — sin mockear ninguna pieza de src/lib/interop/
// ni de src/lib/interop-envios.ts. Secretos ficticios únicamente.
import { describe, test, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { crearHeadersInterop, consultarEnvioRemoto, type EnvioInteropDTO } from '@/lib/interop';
import { crearEnvio, agregarPaquete, cerrarEnvio } from '@/lib/envios';
import { GET } from '@/app/api/interop/envios/[codigo]/route';

const SECRETO_ELA_ENTRANTE = 'test-secret-el-alto-entrante';
const SECRETO_ORU_ENTRANTE = 'test-secret-oruro-entrante';

let userId: string;
let branchId: string;
let destinoElaId: string;
let seq = 0;

async function crearPaqueteDePrueba(): Promise<string> {
  seq++;
  const inicial = 'Y';
  await prisma.packageSeries.upsert({ where: { inicial }, update: {}, create: { inicial, descripcion: 'Prueba interop route' } });
  const code = `Y1T-${seq}`;
  const pkg = await prisma.package.create({
    data: { code, codigoNormalizado: code.replace(/-/g, ''), inicial, branchId, status: 'EN_PAQUETERIA', registradoPorId: userId },
  });
  return pkg.code;
}

/** Construye un NextRequest real, firmado con crearHeadersInterop() — el mismo mecanismo que usará cualquier instalación real. */
function construirRequestFirmado(
  secreto: string,
  sucursalCodigo: string,
  path: string,
  opts?: { timestamp?: number; nonce?: string; sucursalHeaderOverride?: string; signatureOverride?: string }
): NextRequest {
  const headers = crearHeadersInterop({ sucursalCodigo, secreto, method: 'GET', path, body: '', timestamp: opts?.timestamp, nonce: opts?.nonce });
  if (opts?.sucursalHeaderOverride !== undefined) headers['X-Cofre-Sucursal'] = opts.sucursalHeaderOverride;
  if (opts?.signatureOverride !== undefined) headers['X-Cofre-Signature'] = opts.signatureOverride;
  return new NextRequest(`http://localhost${path}`, { method: 'GET', headers });
}

let codigoEnvioCerrado: string;

beforeAll(async () => {
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
  });

  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba interop-route' } });
  branchId = branch.id;
  const user = await prisma.user.create({ data: { username: 'admin-interop-route-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId } });
  userId = user.id;

  const destinoEla = await prisma.sucursalDestino.create({ data: { codigo: 'ELA', nombre: 'Cofre Express El Alto', apiKeyEntrante: SECRETO_ELA_ENTRANTE } });
  destinoElaId = destinoEla.id;
  await prisma.sucursalDestino.create({ data: { codigo: 'ORU', nombre: 'Cofre Express Oruro', apiKeyEntrante: SECRETO_ORU_ENTRANTE } });
  // Sucursal SIN comunicación configurada (apiKeyEntrante null) — para confirmar que "existe pero sin secreto" también es 401.
  await prisma.sucursalDestino.create({ data: { codigo: 'SIN', nombre: 'Sucursal sin comunicación configurada' } });

  const codigo1 = await crearPaqueteDePrueba();
  const envio = await crearEnvio(destinoElaId, userId);
  await agregarPaquete(envio.id, codigo1, userId);
  const cerrado = await cerrarEnvio(envio.id, userId);
  codigoEnvioCerrado = cerrado.codigo;
});

describe('Fase 4.3 — GET /api/interop/envios/[codigo]: casos de aceptación', () => {
  test('1) y 8) GET autenticado válido, lote correcto -> 200 con el DTO esperado', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);

    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(200);

    const dto = (await res.json()) as EnvioInteropDTO;
    expect(dto.codigo).toBe(codigoEnvioCerrado);
    expect(dto.estado).toBe('CERRADO');
    expect(dto.origen).toEqual({ codigo: 'LPZ', nombre: 'Cofre Express La Paz' });
    expect(dto.destino).toEqual({ codigo: 'ELA', nombre: 'Cofre Express El Alto' });
    expect(dto.cantidadPaquetes).toBe(1);
    expect(dto.paquetes).toHaveLength(1);
    expect(typeof dto.transferenciaId === 'string' || dto.transferenciaId === null).toBe(true);
    expect(dto.cerradoAt).toEqual(expect.any(String));
  });

  test('6) lote inexistente -> 404', async () => {
    const path = '/api/interop/envios/ENV-NO-EXISTE-999';
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: 'ENV-NO-EXISTE-999' } });
    expect(res.status).toBe(404);
  });

  test('12) código con minúsculas se normaliza y encuentra igual (la firma cubre el path TAL CUAL, la normalización es solo para la búsqueda)', async () => {
    const codigoMinusculas = codigoEnvioCerrado.toLowerCase();
    const path = `/api/interop/envios/${codigoMinusculas}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoMinusculas } });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as EnvioInteropDTO;
    expect(dto.codigo).toBe(codigoEnvioCerrado);
  });

  test('12b) código con caracteres especiales/no existente no rompe el endpoint (nunca 500)', async () => {
    const codigoRaro = "ENV' OR '1'='1";
    const path = `/api/interop/envios/${encodeURIComponent(codigoRaro)}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoRaro } });
    expect(res.status).toBe(404); // no existe, pero responde limpio — nunca 500
  });
});

describe('Fase 4.3 — GET /api/interop/envios/[codigo]: casos de rechazo', () => {
  test('2) firma incorrecta -> 401', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { signatureOverride: 'f'.repeat(64) });
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(401);
  });

  test('3) timestamp inválido (fuera de ventana) -> 401', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const timestampViejo = Math.floor(Date.now() / 1000) - 3600; // 1 hora antes
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { timestamp: timestampViejo });
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(401);
  });

  test('4) nonce repetido -> la primera llamada acepta, la segunda (idéntica) rechaza con 401', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const nonceFijo = 'nonce-fijo-para-repetir-en-route-test';
    const req1 = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { nonce: nonceFijo });
    const res1 = await GET(req1, { params: { codigo: codigoEnvioCerrado } });
    expect(res1.status).toBe(200);

    const req2 = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { nonce: nonceFijo });
    const res2 = await GET(req2, { params: { codigo: codigoEnvioCerrado } });
    expect(res2.status).toBe(401);
  });

  test('5) sucursal desconocida -> 401', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado('cualquier-secreto', 'NOEXISTE', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(401);
  });

  test('5b) sucursal existente pero sin apiKeyEntrante configurado -> 401 (no 500)', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado('cualquier-secreto', 'SIN', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(401);
  });

  test('7) sucursal autenticada correctamente, pero NO es el destino de este envío -> 403', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    // ORU se autentica con SU PROPIO secreto real (válido) — pero el envío es para ELA, no para ORU.
    const req = construirRequestFirmado(SECRETO_ORU_ENTRANTE, 'ORU', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(403);
  });

  test('10) secreto incorrecto (sucursal real, clave equivocada) -> 401', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado('secreto-que-no-es-el-de-ela', 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    expect(res.status).toBe(401);
  });
});

describe('Fase 4.3 — el DTO nunca expone información que no debería salir de la instalación', () => {
  test('9) el DTO no contiene ningún secreto (apiKeyEntrante/apiKeySaliente) ni datos de autenticación', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    const crudo = await res.text();
    expect(crudo).not.toContain(SECRETO_ELA_ENTRANTE);
    expect(crudo.toLowerCase()).not.toContain('apikey');
    expect(crudo.toLowerCase()).not.toContain('passwordhash');
  });

  test('10) el DTO no es el objeto Prisma completo — solo las claves explícitas del DTO de interop, nunca id/packageId/creadoPor/cerradoPor', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    const dto = await res.json();

    expect(Object.keys(dto).sort()).toEqual(['cantidadPaquetes', 'cerradoAt', 'codigo', 'destino', 'estado', 'origen', 'paquetes', 'transferenciaId'].sort());
    expect(dto.id).toBeUndefined();
    expect(dto.creadoPor).toBeUndefined();
    expect(dto.cerradoPor).toBeUndefined();
    for (const paquete of dto.paquetes) {
      expect(Object.keys(paquete).sort()).toEqual(['codigo', 'destinatario', 'destinatarioTelefono', 'estadoPago', 'montoPagado'].sort());
      expect(paquete.id).toBeUndefined();
      expect(paquete.packageId).toBeUndefined();
    }
  });

  test('14) el qrToken NO aparece en esta respuesta de solo consulta (decisión explícita de Fase 4.3 — ver dto.ts)', async () => {
    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    const req = construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path);
    const res = await GET(req, { params: { codigo: codigoEnvioCerrado } });
    const dto = await res.json();
    expect('qrToken' in dto).toBe(false);
  });
});

describe('Fase 4.3 — el GET nunca escribe nada', () => {
  test('13) ninguna operación de escritura ocurre durante una serie de consultas (conteos intactos)', async () => {
    const contarTodo = () =>
      Promise.all([prisma.envio.count(), prisma.envioItem.count(), prisma.package.count(), prisma.envioRecepcionRemota.count()]);

    const antes = await contarTodo();

    const path = `/api/interop/envios/${codigoEnvioCerrado}`;
    await GET(construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { nonce: 'nonce-para-prueba-de-no-escritura-1' }), { params: { codigo: codigoEnvioCerrado } });
    await GET(construirRequestFirmado(SECRETO_ELA_ENTRANTE, 'ELA', path, { nonce: 'nonce-para-prueba-de-no-escritura-2' }), { params: { codigo: 'ENV-NO-EXISTE-XYZ' } });
    await GET(construirRequestFirmado(SECRETO_ORU_ENTRANTE, 'ORU', path, { nonce: 'nonce-para-prueba-de-no-escritura-3' }), { params: { codigo: codigoEnvioCerrado } });

    const despues = await contarTodo();
    expect(despues).toEqual(antes);
  });
});

describe('Fase 4.3 — consultarEnvioRemoto(): cliente HTTP saliente', () => {
  test('11) genera correctamente la firma — recomputada de forma independiente, coincide con lo enviado', async () => {
    let capturado: { url: string; init: RequestInit } | null = null;
    const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
      capturado = { url: url.toString(), init: init ?? {} };
      const dto: EnvioInteropDTO = {
        transferenciaId: 'tid-1',
        codigo: 'ENV-1',
        estado: 'CERRADO',
        origen: { codigo: 'LPZ', nombre: 'La Paz' },
        destino: { codigo: 'ELA', nombre: 'El Alto' },
        cantidadPaquetes: 0,
        paquetes: [],
        cerradoAt: null,
      };
      return new Response(JSON.stringify(dto), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const dto = await consultarEnvioRemoto({
      apiUrlSaliente: 'https://elalto.example.test',
      codigo: 'ENV-1',
      apiKeySaliente: SECRETO_ELA_ENTRANTE,
      sucursalCodigo: 'LPZ',
      fetchImpl: fetchFalso,
    });

    expect(dto.codigo).toBe('ENV-1');
    expect(capturado).not.toBeNull();
    expect(capturado!.url).toBe('https://elalto.example.test/api/interop/envios/ENV-1');

    const headersEnviados = capturado!.init.headers as Record<string, string>;
    expect(headersEnviados['X-Cofre-Sucursal']).toBe('LPZ');
    expect(headersEnviados['X-Cofre-Nonce']).toBeTruthy();
    expect(headersEnviados['X-Cofre-Timestamp']).toBeTruthy();

    // Recomputo la firma esperada de forma INDEPENDIENTE (usando
    // crearHeadersInterop con los mismos timestamp/nonce capturados) y
    // confirmo que coincide con la que el cliente realmente envió.
    const esperado = crearHeadersInterop({
      sucursalCodigo: 'LPZ',
      secreto: SECRETO_ELA_ENTRANTE,
      method: 'GET',
      path: '/api/interop/envios/ENV-1',
      body: '',
      timestamp: Number(headersEnviados['X-Cofre-Timestamp']),
      nonce: headersEnviados['X-Cofre-Nonce'],
    });
    expect(headersEnviados['X-Cofre-Signature']).toBe(esperado['X-Cofre-Signature']);
  });
});
