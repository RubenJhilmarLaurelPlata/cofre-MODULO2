// tests/tracking-worker.test.ts
// Fase 5.3P — categoría OUTBOX (worker): procesarLoteOutbox() con un
// `fetchImpl` inyectado (nunca red real aquí — la integración con HTTP
// real vive en tests/tracking-integracion.test.ts). Cubre: marcar SENT,
// mantener PENDING con backoff acotado al fallar, no reintentar antes de
// nextAttemptAt, no enviar dos veces la misma fila bajo dos llamadas
// "concurrentes" (mismo patrón optimista que el resto del proyecto), y
// el caso sin TRACKING_URL/TRACKING_HMAC_SECRET configurados.
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registrarPaqueteBasico } from '@/lib/paquete-registro';
import { procesarLoteOutbox, calcularNextAttempt } from '@/lib/tracking/worker';

let branchId: string;
let userId: string;
let seq = 0;

async function crearEventoPendiente(): Promise<{ code: string; eventId: string }> {
  seq++;
  const code = `W5T-${seq}`;
  const pkg = await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
  const historial = await prisma.packageHistory.findFirstOrThrow({ where: { packageId: pkg.id } });
  return { code, eventId: historial.id };
}

const ENV_ORIGINAL = { ...process.env };

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba tracking-worker' } });
  branchId = branch.id;
  const user = await prisma.user.create({
    data: { username: 'admin-tracking-worker-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  await prisma.packageSeries.upsert({ where: { inicial: 'W' }, update: {}, create: { inicial: 'W', descripcion: 'Prueba tracking worker' } });
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
  });
});

beforeEach(() => {
  process.env.TRACKING_URL = 'http://tracking.invalido.test';
  process.env.TRACKING_HMAC_SECRET = 'secreto-de-prueba';
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe('worker — backoff exponencial acotado (Fase 5.3I)', () => {
  test('crece geométricamente y nunca supera el tope', () => {
    const ahora = new Date('2026-01-01T00:00:00Z');
    const d1 = calcularNextAttempt(1, ahora).getTime() - ahora.getTime();
    const d2 = calcularNextAttempt(2, ahora).getTime() - ahora.getTime();
    const d3 = calcularNextAttempt(3, ahora).getTime() - ahora.getTime();
    const d20 = calcularNextAttempt(20, ahora).getTime() - ahora.getTime();
    expect(d2).toBe(d1 * 2);
    expect(d3).toBe(d1 * 4);
    expect(d20).toBe(30 * 60_000); // a los 20 intentos ya está en el tope, nunca crece sin límite
  });
});

describe('worker — envío exitoso', () => {
  test('marca SENT, guarda sentAt, y firma con la cabecera HMAC correcta', async () => {
    const { eventId } = await crearEventoPendiente();
    let headersRecibidos: Headers | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      headersRecibidos = new Headers(init?.headers);
      return new Response(JSON.stringify({ recibido: true }), { status: 201 });
    }) as typeof fetch;

    const resultado = await procesarLoteOutbox({ fetchImpl });
    expect(resultado.enviados).toBeGreaterThanOrEqual(1);

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT');
    expect(fila.sentAt).not.toBeNull();
    expect(fila.lastError).toBeNull();

    expect(headersRecibidos?.get('X-Cofre-Sucursal')).toBe('LPZ');
    expect(headersRecibidos?.get('X-Cofre-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('worker — falla de red / rechazo', () => {
  test('Tracking caído (fetch rechaza): la fila sigue PENDING, intentos+1, nextAttemptAt en el futuro, lastError sin secretos', async () => {
    const { eventId } = await crearEventoPendiente();
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:1');
    }) as unknown as typeof fetch;

    const antes = new Date();
    const resultado = await procesarLoteOutbox({ fetchImpl, ahora: antes });
    expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.intentos).toBe(1);
    expect(fila.nextAttemptAt.getTime()).toBeGreaterThan(antes.getTime());
    expect(fila.lastError).toContain('RED');
    expect(fila.lastError).not.toContain('secreto-de-prueba');
  });

  test('una fila con nextAttemptAt futuro no se vuelve a seleccionar todavía', async () => {
    const { eventId } = await crearEventoPendiente();
    await prisma.outboxEvent.update({ where: { eventId }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });

    const fetchImpl = (async () => new Response(JSON.stringify({ recibido: true }), { status: 201 })) as typeof fetch;
    const resultado = await procesarLoteOutbox({ fetchImpl });

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING'); // nunca se tocó
    expect(resultado.procesados).toBe(0);
  });

  test('HTTP no-ok (ej. 401) se trata como RECHAZADO, no como excepción', async () => {
    const { eventId } = await crearEventoPendiente();
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'no' }), { status: 401 })) as typeof fetch;

    await procesarLoteOutbox({ fetchImpl });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.lastError).toContain('RECHAZADO');
  });
});

describe('worker — sin configurar', () => {
  test('sin TRACKING_URL/TRACKING_HMAC_SECRET, la fila queda PENDING con lastError=NO_CONFIGURADO (nunca lanza)', async () => {
    delete process.env.TRACKING_URL;
    delete process.env.TRACKING_HMAC_SECRET;
    const { eventId } = await crearEventoPendiente();

    await expect(procesarLoteOutbox()).resolves.toBeTruthy();
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.lastError).toContain('NO_CONFIGURADO');
  });
});

describe('worker — concurrencia (Fase 5.3J)', () => {
  test('dos llamadas "simultáneas" a procesarLoteOutbox nunca envían la misma fila dos veces', async () => {
    const { eventId } = await crearEventoPendiente();
    let llamadasAFetch = 0;
    const fetchImpl = (async () => {
      llamadasAFetch++;
      return new Response(JSON.stringify({ recibido: true }), { status: 201 });
    }) as typeof fetch;

    // fileParallelism=false (ver vitest.config.ts) serializa el acceso al
    // mismo archivo SQLite igual que dos procesos PM2 reales bajo
    // connection_limit=1 — Promise.all aquí sigue probando el mismo
    // invariante real: el segundo `updateMany` de claim encuentra 0 filas
    // porque el primero ya movió el estado a SENDING/SENT antes de que el
    // segundo llegue a su propio claim.
    const [a, b] = await Promise.all([procesarLoteOutbox({ fetchImpl }), procesarLoteOutbox({ fetchImpl })]);

    expect(llamadasAFetch).toBe(1);
    expect(a.enviados + b.enviados).toBe(1);
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT');
  });
});
