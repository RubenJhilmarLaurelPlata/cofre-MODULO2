// tests/interop-auth.test.ts
// Fase 4.2: capa de autenticación inter-sucursales (src/lib/interop/).
// Sin servidor real, sin Prisma, sin Next.js — construye headers con
// crearHeadersInterop() y los valida con verificarFirmaInterop(), tal
// como lo hará (en la Fase 4.3) el adaptador real de /api/interop/*.
// Secretos ficticios únicamente (nunca reales) — ver instrucción de esta
// fase.
import { describe, test, expect } from 'vitest';
import {
  construirCanonicalRequest,
  sha256Hex,
  firmarRequest,
  compararTimingSafe,
  crearHeadersInterop,
  verificarFirmaInterop,
  crearAlmacenNonceEnMemoria,
  CABECERA_SUCURSAL,
  CABECERA_TIMESTAMP,
  CABECERA_NONCE,
  CABECERA_FIRMA,
  type CabecerasInteropEntrada,
} from '@/lib/interop';

const SECRETO_LPZ = 'test-secret-la-paz';
const SECRETO_ELA = 'test-secret-el-alto';

const SECRETOS_ENTRANTES: Record<string, string> = { LPZ: SECRETO_LPZ, ELA: SECRETO_ELA };
async function resolverSecretoDePrueba(sucursalCodigo: string): Promise<string | null> {
  return SECRETOS_ENTRANTES[sucursalCodigo] ?? null;
}

function headersDeInteropACabeceras(h: Record<string, string>): CabecerasInteropEntrada {
  return { sucursal: h[CABECERA_SUCURSAL], timestamp: h[CABECERA_TIMESTAMP], nonce: h[CABECERA_NONCE], signature: h[CABECERA_FIRMA] };
}

interface PeticionDePrueba {
  method: string;
  path: string;
  body: string;
}

function firmarParaPrueba(secreto: string, sucursalCodigo: string, req: PeticionDePrueba, extra?: { timestamp?: number; nonce?: string }) {
  const headers = crearHeadersInterop({ sucursalCodigo, secreto, method: req.method, path: req.path, body: req.body, ...extra });
  return { headers, cabeceras: headersDeInteropACabeceras(headers) };
}

const PETICION_BASE: PeticionDePrueba = { method: 'POST', path: '/api/interop/envios/ENV-20260904-001/recibir', body: '{"confirmar":true}' };

describe('Fase 4.2 — construirCanonicalRequest: canonicalización determinista', () => {
  test('la misma entrada produce siempre el mismo string canónico', () => {
    const input = { method: 'post', path: '/x', timestamp: '100', nonce: 'n1', body: 'hola' };
    expect(construirCanonicalRequest(input)).toBe(construirCanonicalRequest({ ...input }));
  });

  test('normaliza el método a mayúsculas', () => {
    const a = construirCanonicalRequest({ method: 'post', path: '/x', timestamp: '1', nonce: 'n', body: '' });
    const b = construirCanonicalRequest({ method: 'POST', path: '/x', timestamp: '1', nonce: 'n', body: '' });
    expect(a).toBe(b);
  });

  test('cambiar el path cambia el string canónico', () => {
    const base = { method: 'GET', path: '/a', timestamp: '1', nonce: 'n', body: '' };
    expect(construirCanonicalRequest(base)).not.toBe(construirCanonicalRequest({ ...base, path: '/b' }));
  });

  test('cambiar el body cambia el string canónico (a través del hash)', () => {
    const base = { method: 'GET', path: '/a', timestamp: '1', nonce: 'n', body: 'x' };
    expect(construirCanonicalRequest(base)).not.toBe(construirCanonicalRequest({ ...base, body: 'y' }));
  });

  test('body vacío produce el hash SHA-256 conocido de la cadena vacía', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('Fase 4.2 — firmarRequest / compararTimingSafe', () => {
  test('comparación timing-safe: strings iguales -> true', () => {
    expect(compararTimingSafe('abc123', 'abc123')).toBe(true);
  });

  test('comparación timing-safe: mismo largo, contenido distinto -> false', () => {
    expect(compararTimingSafe('abc123', 'abc124')).toBe(false);
  });

  test('comparación timing-safe: largos distintos -> false, sin lanzar', () => {
    expect(() => compararTimingSafe('abc', 'abcdef')).not.toThrow();
    expect(compararTimingSafe('abc', 'abcdef')).toBe(false);
  });

  test('un secreto distinto produce una firma distinta para el mismo mensaje', () => {
    const input = { method: 'GET', path: '/x', timestamp: '1', nonce: 'n', body: '' };
    expect(firmarRequest(SECRETO_LPZ, input)).not.toBe(firmarRequest(SECRETO_ELA, input));
  });
});

describe('Fase 4.2 — verificarFirmaInterop: casos de aceptación', () => {
  test('1) firma válida -> acepta, e identifica correctamente a la sucursal emisora', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      headers: cabeceras,
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: true, sucursalCodigo: 'LPZ' });
  });

  test('6) timestamp válido (dentro de la ventana) -> acepta', async () => {
    const ahora = 1_800_000_000;
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { timestamp: ahora - 60 });
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria(), ahora });
    expect(resultado.ok).toBe(true);
  });

  test('13) body vacío funciona correctamente (ej. una consulta GET sin cuerpo)', async () => {
    const req: PeticionDePrueba = { method: 'GET', path: '/api/interop/envios/ENV-20260904-001', body: '' };
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', req);
    const resultado = await verificarFirmaInterop({ ...req, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    expect(resultado.ok).toBe(true);
  });

  test('14) Unicode en el body funciona correctamente', async () => {
    const req: PeticionDePrueba = { method: 'POST', path: '/api/interop/envios/ENV-1/recibir', body: JSON.stringify({ nota: 'Envío a São Paulo 🚚 — Ñandú, corazón' }) };
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', req);
    const resultado = await verificarFirmaInterop({ ...req, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    expect(resultado.ok).toBe(true);
  });
});

describe('Fase 4.2 — verificarFirmaInterop: casos de rechazo', () => {
  test('2) body alterado en tránsito -> rechaza con FIRMA_INVALIDA', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      body: '{"confirmar":false}', // distinto del firmado
      headers: cabeceras,
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  test('3) path alterado -> rechaza con FIRMA_INVALIDA', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      path: '/api/interop/envios/ENV-OTRO/recibir',
      headers: cabeceras,
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  test('4) método alterado -> rechaza con FIRMA_INVALIDA', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      method: 'GET',
      headers: cabeceras,
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  test('5) timestamp fuera de ventana (±5 min) -> rechaza con TIMESTAMP_INVALIDO', async () => {
    const ahora = 1_800_000_000;
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { timestamp: ahora - 600 }); // 10 min antes
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria(), ahora });
    expect(resultado).toEqual({ ok: false, motivo: 'TIMESTAMP_INVALIDO' });
  });

  test('5b) timestamp del futuro fuera de ventana también se rechaza (la ventana es simétrica)', async () => {
    const ahora = 1_800_000_000;
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { timestamp: ahora + 600 });
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria(), ahora });
    expect(resultado).toEqual({ ok: false, motivo: 'TIMESTAMP_INVALIDO' });
  });

  test('5c) timestamp no numérico -> rechaza con TIMESTAMP_INVALIDO, sin lanzar', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      headers: { ...cabeceras, timestamp: 'no-es-un-numero' },
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: false, motivo: 'TIMESTAMP_INVALIDO' });
  });

  test('7) nonce vacío -> rechaza con NONCE_INVALIDO', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { nonce: '' });
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    expect(resultado).toEqual({ ok: false, motivo: 'NONCE_INVALIDO' });
  });

  test('8) nonce repetido -> la primera vez acepta, la segunda (idéntica) rechaza con NONCE_INVALIDO', async () => {
    const almacen = crearAlmacenNonceEnMemoria();
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { nonce: 'nonce-fijo-de-prueba' });

    const primera = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: almacen });
    expect(primera.ok).toBe(true);

    const segunda = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: almacen });
    expect(segunda).toEqual({ ok: false, motivo: 'NONCE_INVALIDO' });
  });

  test('8b) el mismo nonce para sucursales distintas NO choca entre sí (aislado por sucursal)', async () => {
    const almacen = crearAlmacenNonceEnMemoria();
    const nonceCompartido = 'nonce-compartido';

    const deLpz = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE, { nonce: nonceCompartido });
    const deEla = firmarParaPrueba(SECRETO_ELA, 'ELA', PETICION_BASE, { nonce: nonceCompartido });

    const resultadoLpz = await verificarFirmaInterop({ ...PETICION_BASE, headers: deLpz.cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: almacen });
    const resultadoEla = await verificarFirmaInterop({ ...PETICION_BASE, headers: deEla.cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: almacen });

    expect(resultadoLpz.ok).toBe(true);
    expect(resultadoEla.ok).toBe(true);
  });

  test('9) sucursal desconocida -> rechaza con SUCURSAL_DESCONOCIDA', async () => {
    const { cabeceras } = firmarParaPrueba('un-secreto-cualquiera', 'ORU', PETICION_BASE); // "ORU" no está en el resolver de prueba
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    expect(resultado).toEqual({ ok: false, motivo: 'SUCURSAL_DESCONOCIDA' });
  });

  test('9b) cabecera de sucursal ausente -> rechaza con SUCURSAL_DESCONOCIDA', async () => {
    const { cabeceras } = firmarParaPrueba(SECRETO_LPZ, 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({
      ...PETICION_BASE,
      headers: { ...cabeceras, sucursal: undefined },
      resolverSecreto: resolverSecretoDePrueba,
      nonceStore: crearAlmacenNonceEnMemoria(),
    });
    expect(resultado).toEqual({ ok: false, motivo: 'SUCURSAL_DESCONOCIDA' });
  });

  test('10) secreto incorrecto (sucursal real, pero firmado con otra clave) -> rechaza con FIRMA_INVALIDA', async () => {
    const { cabeceras } = firmarParaPrueba('secreto-equivocado', 'LPZ', PETICION_BASE); // LPZ existe, pero el secreto usado para firmar no es SECRETO_LPZ
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    expect(resultado).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  test('el motivo de rechazo nunca contiene el secreto ni la firma', async () => {
    const { cabeceras } = firmarParaPrueba('secreto-equivocado', 'LPZ', PETICION_BASE);
    const resultado = await verificarFirmaInterop({ ...PETICION_BASE, headers: cabeceras, resolverSecreto: resolverSecretoDePrueba, nonceStore: crearAlmacenNonceEnMemoria() });
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain(SECRETO_LPZ);
    expect(serializado).not.toContain('secreto-equivocado');
    expect(serializado).not.toContain(cabeceras.signature);
  });
});
