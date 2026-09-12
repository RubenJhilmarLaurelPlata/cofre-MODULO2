// tests/tracking-outbox.test.ts
// Fase 5.3P — categorías OUTBOX y EVENTOS. Contra SQLite real de prueba
// (ver tests/setup.ts), nunca contra prisma/dev.db. Cubre: inserción
// atómica del Outbox junto con la operación real (y su rollback
// conjunto), los 4 puntos de instrumentación priorizados (registrar
// paquete, cerrar envío, recibir envío, entregar paquete/entrega
// excepcional), forma exacta del payload (sin PII/secretos/IDs
// internos), estabilidad de eventId entre reintentos, fechaOrigen real
// (nunca la del momento de leer el Outbox), y el caso límite de
// identidad (paquete materializado por interop / instalación sin
// Company.sucursalCodigo configurado).
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registrarPaqueteBasico } from '@/lib/paquete-registro';
import { entregarPaquete, enviarADeposito, denegarPaquete, entregaExcepcional } from '@/lib/package-transitions';
import { crearEnvio, agregarPaquete, cerrarEnvio, recibirEnvio } from '@/lib/envios';
import type { PayloadEventoTracking } from '@/lib/tracking/eventos';

let branchId: string;
let userId: string;
let seq = 0;

function nuevoCodigo(): string {
  seq++;
  return `T5T-${seq}`;
}

async function outboxDe(tipoEvento: string) {
  return prisma.outboxEvent.findMany({ where: { tipoEvento }, orderBy: { createdAt: 'asc' } });
}

function payloadDe(row: { payload: string }): PayloadEventoTracking {
  return JSON.parse(row.payload) as PayloadEventoTracking;
}

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba tracking-outbox' } });
  branchId = branch.id;
  const user = await prisma.user.create({
    data: { username: 'admin-tracking-outbox-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  await prisma.packageSeries.upsert({ where: { inicial: 'T' }, update: {}, create: { inicial: 'T', descripcion: 'Prueba tracking' } });
});

beforeEach(async () => {
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
  });
});

describe('OUTBOX — registrar paquete (prioridad 1)', () => {
  test('registrarPaqueteBasico() encola un OutboxEvent PENDING con tipoEvento PAQUETE_REGISTRADO, en la misma transacción', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) => {
      await registrarPaqueteBasico(tx, code, branchId, userId);
    });

    const fila = await prisma.outboxEvent.findFirst({ where: { tipoEvento: 'PAQUETE_REGISTRADO', origenSucursalCodigo: 'LPZ' }, orderBy: { createdAt: 'desc' } });
    expect(fila).toBeTruthy();
    expect(fila!.estado).toBe('PENDING');
    expect(fila!.intentos).toBe(0);
    expect(fila!.sentAt).toBeNull();

    const payload = payloadDe(fila!);
    expect(payload.codigo).toBe(code);
    expect(payload.origenSucursalCodigo).toBe('LPZ');
    expect(payload.tipoEvento).toBe('PAQUETE_REGISTRADO');
    expect(payload.estadoInternoOrigen).toBe('EN_PAQUETERIA');
  });

  test('si la transacción de negocio falla, el OutboxEvent NO queda creado (rollback conjunto — Fase 5.3D)', async () => {
    const antes = await prisma.outboxEvent.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await registrarPaqueteBasico(tx, 'ZZZ-SIN-SERIE', branchId, userId); // inicial "ZZZ" nunca tiene PackageSeries -> lanza y revierte
      })
    ).rejects.toThrow();
    const despues = await prisma.outboxEvent.count();
    expect(despues).toBe(antes);
  });

  test('eventId = PackageHistory.id de la fila real creada (Fase 5.3F)', async () => {
    const code = nuevoCodigo();
    const pkg = await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { packageId: pkg.id } });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historial.id } });
    expect(fila.tipoEvento).toBe('PAQUETE_REGISTRADO');
  });

  test('el payload nunca incluye destinatario/teléfono/nota/userId/IDs internos', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) =>
      registrarPaqueteBasico(tx, code, branchId, userId, {}, { destinatario: 'Cliente Secreto', destinatarioTelefono: '70000000' })
    );
    const fila = await prisma.outboxEvent.findFirstOrThrow({ where: { eventId: (await prisma.packageHistory.findFirstOrThrow({ where: { package: { code } } })).id } });
    const crudo = fila.payload;
    expect(crudo).not.toContain('Cliente Secreto');
    expect(crudo).not.toContain('70000000');
    expect(crudo).not.toContain(userId);
    expect(crudo).not.toContain(branchId);
  });
});

describe('OUTBOX — transiciones de paquete (entregar / depósito / denegar)', () => {
  test('entregarPaquete() encola PAQUETE_TRANSICION con estadoInternoOrigen=ENTREGADO', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    await entregarPaquete(code, userId);

    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { estado: 'ENTREGADO', package: { code } } });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historial.id } });
    expect(fila.tipoEvento).toBe('PAQUETE_TRANSICION');
    expect(payloadDe(fila).estadoInternoOrigen).toBe('ENTREGADO');
  });

  test('la fechaOrigen del payload es la fecha REAL de la transición, no una posterior (Fase 5.3G)', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    const antes = Date.now();
    await enviarADeposito(code, userId);
    const despues = Date.now();

    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { estado: 'EN_DEPOSITO', package: { code } } });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historial.id } });
    const fechaOrigenMs = new Date(payloadDe(fila).fechaOrigen).getTime();
    expect(fechaOrigenMs).toBeGreaterThanOrEqual(antes);
    expect(fechaOrigenMs).toBeLessThanOrEqual(despues);
  });

  test('denegarPaquete() encola PAQUETE_TRANSICION con estadoInternoOrigen=DENEGADO (cofre-tracking decide ocultarlo, no esta instalación)', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    await denegarPaquete(code, userId);

    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { estado: 'DENEGADO', package: { code } } });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historial.id } });
    expect(payloadDe(fila).estadoInternoOrigen).toBe('DENEGADO');
  });

  test('reintentos del worker nunca cambian el eventId ya guardado (estable — Fase 5.3F)', async () => {
    const code = nuevoCodigo();
    await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    await entregarPaquete(code, userId);

    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { estado: 'ENTREGADO', package: { code } } });
    const antes = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historial.id } });
    // Simula "el worker lo reintenta más tarde": nada en el sistema vuelve
    // a llamar a emitirEventoPaquete() para esta misma fila — solo el
    // worker actualiza intentos/nextAttemptAt/estado, nunca eventId.
    await prisma.outboxEvent.update({ where: { id: antes.id }, data: { intentos: 3, estado: 'PENDING' } });
    const despues = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: antes.id } });
    expect(despues.eventId).toBe(antes.eventId);
    expect(despues.payload).toBe(antes.payload); // el payload congelado tampoco cambia (Fase 5.3G)
  });
});

describe('OUTBOX — entrega excepcional (crea + entrega en una sola transacción)', () => {
  test('encola AMBOS eventos: PAQUETE_REGISTRADO y PAQUETE_TRANSICION(ENTREGADO)', async () => {
    const code = nuevoCodigo();
    const pkg = await entregaExcepcional(code, userId, branchId, { motivoExcepcional: 'NO_REGISTRADO_AL_INGRESAR', montoCobrado: 0, exonerado: true, motivoExoneracion: 'Prueba' });

    const historiales = await prisma.packageHistory.findMany({ where: { packageId: pkg.id }, orderBy: { fecha: 'asc' } });
    expect(historiales).toHaveLength(2);

    const filaRegistro = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historiales[0]!.id } });
    const filaEntrega = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: historiales[1]!.id } });
    expect(filaRegistro.tipoEvento).toBe('PAQUETE_REGISTRADO');
    expect(filaEntrega.tipoEvento).toBe('PAQUETE_TRANSICION');
    expect(payloadDe(filaEntrega).estadoInternoOrigen).toBe('ENTREGADO');
  });
});

describe('OUTBOX — cerrar / recibir envío (prioridades 2 y 3, fan-out por paquete)', () => {
  test('cerrarEnvio() encola un ENVIO_CERRADO por cada paquete del lote, con destino correcto', async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: `DST${seq}A`, nombre: 'Destino de prueba A' } });
    const envio = await crearEnvio(destino.id, userId);
    const codeA = nuevoCodigo();
    const codeB = nuevoCodigo();
    await agregarPaquete(envio.id, codeA, userId, branchId);
    await agregarPaquete(envio.id, codeB, userId, branchId);

    await cerrarEnvio(envio.id, userId);

    const filas = await outboxDe('ENVIO_CERRADO');
    const codigos = filas.map((f) => payloadDe(f).codigo).sort();
    expect(codigos).toEqual([codeA, codeB].sort());
    for (const f of filas) {
      const p = payloadDe(f);
      expect(p.destinoSucursalCodigo).toBe(destino.codigo);
      expect(p.sucursalActualCodigo).toBe('LPZ'); // en tránsito: sigue siendo esta instalación
    }
  });

  test('recibirEnvio() encola un ENVIO_RECIBIDO por cada paquete, con sucursalActual=destino', async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: `DST${seq}B`, nombre: 'Destino de prueba B' } });
    const envio = await crearEnvio(destino.id, userId);
    const code = nuevoCodigo();
    await agregarPaquete(envio.id, code, userId, branchId);
    await cerrarEnvio(envio.id, userId);

    await recibirEnvio(envio.id, userId);

    const historial = await prisma.envio.findUniqueOrThrow({ where: { id: envio.id } });
    const claveEnvio = historial.transferenciaId ?? historial.id;
    const pkg = await prisma.package.findUniqueOrThrow({ where: { codigoNormalizado: code.replace(/-/g, '') } });
    const eventId = `${claveEnvio}:${pkg.id}:ENVIO_RECIBIDO`;
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    const p = payloadDe(fila);
    expect(p.sucursalActualCodigo).toBe(destino.codigo);
    expect(p.origenSucursalCodigo).toBe('LPZ'); // el origen de la identidad nunca cambia
  });

  test('eventId de ENVIO_CERRADO/ENVIO_RECIBIDO del mismo paquete son distintos entre sí (nunca colisionan)', async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: `DST${seq}C`, nombre: 'Destino de prueba C' } });
    const envio = await crearEnvio(destino.id, userId);
    const code = nuevoCodigo();
    await agregarPaquete(envio.id, code, userId, branchId);
    await cerrarEnvio(envio.id, userId);
    await recibirEnvio(envio.id, userId);

    const pkg = await prisma.package.findUniqueOrThrow({ where: { codigoNormalizado: code.replace(/-/g, '') } });
    const filas = await prisma.outboxEvent.findMany({ where: { eventId: { contains: pkg.id } } });
    const eventIds = new Set(filas.map((f) => f.eventId));
    expect(eventIds.size).toBe(filas.length);
    expect(filas.length).toBe(2);
  });
});

describe('EVENTOS — identidad (casos límite documentados)', () => {
  test('sin Company.sucursalCodigo configurado, no se encola ningún evento (pero la operación real sí ocurre)', async () => {
    await prisma.company.update({ where: { id: 1 }, data: { sucursalCodigo: null, sucursalNombre: null } });
    const code = nuevoCodigo();

    const antes = await prisma.outboxEvent.count();
    const pkg = await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
    const despues = await prisma.outboxEvent.count();

    expect(pkg.status).toBe('EN_PAQUETERIA'); // la operación real nunca se bloquea por esto
    expect(despues).toBe(antes);
  });

  test('un paquete materializado por interop (origenSucursalCodigo de OTRA instalación) no genera su propio evento al transicionar aquí (limitación documentada — ver src/lib/tracking/eventos.ts)', async () => {
    await prisma.sucursalDestino.upsert({ where: { codigo: 'ORIGEN-REMOTO' }, update: {}, create: { codigo: 'ORIGEN-REMOTO', nombre: 'Instalación remota de prueba' } });
    const code = nuevoCodigo();
    const materializado = await prisma.package.create({
      data: {
        code,
        codigoNormalizado: code.replace(/-/g, ''),
        inicial: 'T',
        branchId,
        status: 'EN_PAQUETERIA',
        registradoPorId: userId,
        origenSucursalCodigo: 'ORIGEN-REMOTO',
        origenCodigoPaquete: code,
      },
    });

    const antes = await prisma.outboxEvent.count();
    await entregarPaquete(code, userId);
    const despues = await prisma.outboxEvent.count();

    const entregado = await prisma.package.findUniqueOrThrow({ where: { id: materializado.id } });
    expect(entregado.status).toBe('ENTREGADO'); // la operación real sí ocurre
    expect(despues).toBe(antes); // pero no se encoló ningún evento nuevo (no se puede firmar honestamente como "ORIGEN-REMOTO")
  });
});
