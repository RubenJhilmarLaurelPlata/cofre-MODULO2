// tests/tracking-integracion.test.ts
// Fase 5.3P — categoría INTEGRACIÓN. Mismo criterio ya establecido en
// tests/interop-dos-instalaciones.test.ts (ver su comentario de cabecera
// para la justificación completa): un servidor HTTP real (Node `http`,
// puerto efímero, loopback) que reimplementa el endpoint de ingesta de
// cofre-tracking (POST /tracking/events, Fase 5.2) usando el MISMO
// protocolo HMAC real (src/lib/interop — el que cofre-tracking portó tal
// cual, ver su src/lib/hmac/) — nada mockeado en la firma/verificación.
// No es un segundo proceso de Next.js real (cofre-tracking es un
// repositorio separado, sin acceso a su código desde aquí) — es un
// modelo mínimo pero fiel de su comportamiento documentado: idempotencia
// por eventId único (in-memory), y la misma respuesta mínima
// 200/201="recibido" para evento nuevo/duplicado.
//
// Lo que SÍ queda demostrado de punta a punta con esto: que el worker +
// cliente REALES de esta instalación (src/lib/tracking/worker.ts,
// cliente.ts — nada mockeado ahí tampoco) pueden entregar un evento por
// HTTP real, firmado con HMAC real, y que el sistema completo converge
// correctamente en los tres escenarios pedidos por Fase 5.3P: envío
// exitoso, reintento idempotente (la respuesta se "pierde" pero Tracking
// ya lo tenía), y Tracking caído -> recuperado.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { prisma } from '@/lib/prisma';
import { verificarFirmaInterop } from '@/lib/interop';
import { registrarPaqueteBasico } from '@/lib/paquete-registro';
import { procesarLoteOutbox } from '@/lib/tracking/worker';

const SECRETO_INTEGRACION = 'secreto-de-integracion-fase-5-3';

let branchId: string;
let userId: string;
let seq = 0;

/** Modelo mínimo del event store de cofre-tracking: eventId -> payload recibido. */
const eventStoreDeTracking = new Map<string, unknown>();
let servidor: Server;
let urlBase: string;

async function crearPaquete(): Promise<{ code: string; eventId: string }> {
  seq++;
  const code = `I5T-${seq}`;
  const pkg = await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
  const historial = await prisma.packageHistory.findFirstOrThrow({ where: { packageId: pkg.id } });
  return { code, eventId: historial.id };
}

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba tracking-integracion' } });
  branchId = branch.id;
  const user = await prisma.user.create({
    data: { username: 'admin-tracking-integracion-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  await prisma.packageSeries.upsert({ where: { inicial: 'I' }, update: {}, create: { inicial: 'I', descripcion: 'Prueba tracking integración' } });
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
  });

  servidor = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/tracking/events' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      const auth = await verificarFirmaInterop({
        method: req.method,
        path: url.pathname,
        body,
        headers: {
          sucursal: req.headers['x-cofre-sucursal'] as string | undefined,
          timestamp: req.headers['x-cofre-timestamp'] as string | undefined,
          nonce: req.headers['x-cofre-nonce'] as string | undefined,
          signature: req.headers['x-cofre-signature'] as string | undefined,
        },
        resolverSecreto: async (sucursalCodigo) => (sucursalCodigo === 'LPZ' ? SECRETO_INTEGRACION : null),
      });
      if (!auth.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Autenticación inválida.' }));
        return;
      }
      const payload = JSON.parse(body) as { eventId: string; origenSucursalCodigo: string };
      if (payload.origenSucursalCodigo !== auth.sucursalCodigo) {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Origen no coincide.' }));
        return;
      }
      const duplicado = eventStoreDeTracking.has(payload.eventId);
      if (!duplicado) eventStoreDeTracking.set(payload.eventId, payload);
      res.writeHead(duplicado ? 200 : 201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ recibido: true }));
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const address = servidor.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo levantar el servidor de prueba de Tracking.');
  urlBase = `http://127.0.0.1:${address.port}`;

  process.env.TRACKING_URL = urlBase;
  process.env.TRACKING_HMAC_SECRET = SECRETO_INTEGRACION;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

describe('Fase 5.3P — integración local real (worker + cliente + servidor HTTP + HMAC real)', () => {
  test('un evento pendiente se envía por HTTP real, se firma correctamente, y Tracking lo recibe una sola vez', async () => {
    const { code, eventId } = await crearPaquete();

    const resultado = await procesarLoteOutbox();
    expect(resultado.enviados).toBeGreaterThanOrEqual(1);

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT');

    expect(eventStoreDeTracking.has(eventId)).toBe(true);
    const recibido = eventStoreDeTracking.get(eventId) as { codigo: string };
    expect(recibido.codigo).toBe(code);
  });

  test('reintento idempotente: si la fila vuelve a PENDING (respuesta "perdida"), Tracking no duplica el evento', async () => {
    const { eventId } = await crearPaquete();
    await procesarLoteOutbox(); // primer envío real, exitoso
    expect(eventStoreDeTracking.size).toBeGreaterThan(0);
    const tamanoAntes = eventStoreDeTracking.size;

    // Simula que la respuesta 201 nunca llegó a esta instalación (red
    // cortada justo después de que Tracking ya proceso el evento):
    // vuelve a PENDING SIN cambiar el payload/eventId.
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'PENDING', nextAttemptAt: new Date() } });

    const resultado = await procesarLoteOutbox();
    expect(resultado.enviados).toBe(1); // esta instalación lo vuelve a marcar SENT

    expect(eventStoreDeTracking.size).toBe(tamanoAntes); // Tracking NO agregó una segunda entrada (mismo eventId ya existía)
    const filaFinal = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(filaFinal.estado).toBe('SENT');
  });

  test('Tracking caído -> operación local no se afecta -> al recuperarse, el worker converge sin duplicar', async () => {
    const puertoMuerto = 'http://127.0.0.1:1'; // nada escuchando ahí
    const urlReal = process.env.TRACKING_URL;
    process.env.TRACKING_URL = puertoMuerto;

    const { code, eventId } = await crearPaquete(); // la operación real (Package + PackageHistory + Outbox) sigue funcionando

    const pkgCreado = await prisma.package.findUniqueOrThrow({ where: { code } });
    expect(pkgCreado.status).toBe('EN_PAQUETERIA'); // nunca se bloqueó por Tracking caído

    const primerIntento = await procesarLoteOutbox();
    expect(primerIntento.fallidos).toBeGreaterThanOrEqual(1);
    let fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.intentos).toBe(1);
    expect(eventStoreDeTracking.has(eventId)).toBe(false);

    // "Tracking se recupera": vuelve la URL real, se fuerza el reintento inmediato.
    process.env.TRACKING_URL = urlReal;
    await prisma.outboxEvent.update({ where: { eventId }, data: { nextAttemptAt: new Date() } });
    const segundoIntento = await procesarLoteOutbox();
    expect(segundoIntento.enviados).toBe(1);

    fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT');
    expect(eventStoreDeTracking.has(eventId)).toBe(true); // convergió — Tracking terminó con exactamente una copia
  });
});
