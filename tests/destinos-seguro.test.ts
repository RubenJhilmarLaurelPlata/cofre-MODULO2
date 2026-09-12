// tests/destinos-seguro.test.ts
// Fase 5.3B: corrección de un hallazgo de seguridad de la auditoría de
// Fase 5.1 — GET/POST /api/configuracion/destinos y
// PATCH /api/configuracion/destinos/[id] NUNCA deben devolver
// apiKeySaliente/apiKeyEntrante, ni dejarlos en AuditLog. La sesión y el
// chequeo de permisos se mockean (esto no es una prueba de autenticación
// — eso ya lo cubre tests/permisos.test.ts — es una prueba de que la
// RESPUESTA/AUDITORÍA nunca expone secretos, sin importar qué rol la pida).
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';

const SECRETO_SALIENTE = 'secreto-saliente-nunca-debe-salir';
const SECRETO_ENTRANTE = 'secreto-entrante-nunca-debe-salir';

const SESSION_USER_ID = 'user-destinos-test-id'; // se reemplaza por el id real creado en beforeAll
const sessionFalsa = { id: SESSION_USER_ID, username: 'admin-destinos-test', nombre: 'Admin de prueba', role: 'ADMIN', branchId: null };
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => sessionFalsa) }));
vi.mock('@/lib/permisos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permisos')>();
  return { ...actual, tienePermiso: vi.fn(async () => true) };
});

const { GET, POST } = await import('@/app/api/configuracion/destinos/route');
const { PATCH } = await import('@/app/api/configuracion/destinos/[id]/route');

let destinoId: string;

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba destinos-seguro' } });
  await prisma.user.create({
    data: { id: SESSION_USER_ID, username: 'admin-destinos-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });

  const destino = await prisma.sucursalDestino.create({
    data: {
      codigo: 'SEC1',
      nombre: 'Destino seguro de prueba',
      apiUrlSaliente: 'https://ejemplo.test/interop',
      apiKeySaliente: SECRETO_SALIENTE,
      apiKeyEntrante: SECRETO_ENTRANTE,
    },
  });
  destinoId = destino.id;
});

describe('Fase 5.3B — GET /api/configuracion/destinos', () => {
  test('A) un usuario con envios.ver no recibe apiKeySaliente/apiKeyEntrante, B) el resto de la respuesta sigue funcionando', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const lista = await res.json();
    const destino = lista.find((d: { id: string }) => d.id === destinoId);
    expect(destino).toBeTruthy();
    expect(destino.apiKeySaliente).toBeUndefined();
    expect(destino.apiKeyEntrante).toBeUndefined();
    // B) el resto del comportamiento queda intacto — sigue devolviendo lo que un selector de destino necesita.
    expect(destino.codigo).toBe('SEC1');
    expect(destino.nombre).toBe('Destino seguro de prueba');
    expect(destino.apiUrlSaliente).toBe('https://ejemplo.test/interop'); // esto no es un secreto, sigue visible

    // D) ningún secreto aparece ni siquiera en el texto crudo de la respuesta.
    const crudo = JSON.stringify(lista);
    expect(crudo).not.toContain(SECRETO_SALIENTE);
    expect(crudo).not.toContain(SECRETO_ENTRANTE);
  });
});

describe('Fase 5.3B — POST /api/configuracion/destinos', () => {
  test('la respuesta de creación tampoco expone secretos (siempre null hoy, pero el select ya los excluye igual)', async () => {
    const res = await POST(new Request('http://localhost/api/configuracion/destinos', { method: 'POST', body: JSON.stringify({ codigo: 'SEC2', nombre: 'Otro destino de prueba' }) }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.apiKeySaliente).toBeUndefined();
    expect(data.apiKeyEntrante).toBeUndefined();
  });
});

describe('Fase 5.3B — PATCH /api/configuracion/destinos/[id]', () => {
  test('C) la respuesta del PATCH no incluye los secretos, D) tampoco quedan en AuditLog', async () => {
    const res = await PATCH(new Request(`http://localhost/api/configuracion/destinos/${destinoId}`, { method: 'PATCH', body: JSON.stringify({ ciudad: 'La Paz' }) }), {
      params: { id: destinoId },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.apiKeySaliente).toBeUndefined();
    expect(data.apiKeyEntrante).toBeUndefined();
    expect(data.ciudad).toBe('La Paz'); // B) el resto de la funcionalidad de edición sigue intacta

    const auditoria = await prisma.auditLog.findFirst({ where: { accion: 'DESTINO_ACTUALIZADO', modulo: 'envios' }, orderBy: { createdAt: 'desc' } });
    expect(auditoria).not.toBeNull();
    expect(auditoria!.valorAnterior ?? '').not.toContain(SECRETO_SALIENTE);
    expect(auditoria!.valorAnterior ?? '').not.toContain(SECRETO_ENTRANTE);
    expect(auditoria!.valorNuevo ?? '').not.toContain(SECRETO_SALIENTE);
    expect(auditoria!.valorNuevo ?? '').not.toContain(SECRETO_ENTRANTE);
  });
});
