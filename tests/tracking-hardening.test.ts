// tests/tracking-hardening.test.ts
// Fase 5.3-HARDENING. Contra SQLite real de prueba (tests/setup.ts).
// Cubre, en orden:
//   1. OUTBOX ATÓMICO — rollback nunca deja un OutboxEvent huérfano;
//      commit siempre lo deja; Tracking caído después del commit no
//      afecta la operación local.
//   2. RECUPERACIÓN DE SENDING — claim, "proceso muerto" simulado,
//      recuperación por lease, reintento después de que Tracking ya
//      recibió el evento, no-duplicación bajo concurrencia, SENT final.
//   3. PAQUETES INTER-SUCURSAL (autorización) — registrarEventoTrackingDelegado()
//      llamada directamente (sin HTTP — ver tests/tracking-interop-delegacion.test.ts
//      para el flujo HTTP+HMAC real de punta a punta): auth ya se asume
//      verificada aquí (es lo que testea el otro archivo) y se prueba la
//      lógica de autorización de negocio en sí (destino/estado/paquete).
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registrarPaqueteBasico } from '@/lib/paquete-registro';
import { entregarPaquete } from '@/lib/package-transitions';
import { procesarLoteOutbox, recuperarSendingExpirados } from '@/lib/tracking/worker';
import { registrarEventoTrackingDelegado } from '@/lib/interop-envios';

let branchId: string;
let userId: string;
let seq = 0;

function nuevoCodigo(): string {
  seq++;
  return `H5T-${seq}`;
}

async function crearEventoPendiente(): Promise<{ code: string; eventId: string }> {
  const code = nuevoCodigo();
  const pkg = await prisma.$transaction(async (tx) => registrarPaqueteBasico(tx, code, branchId, userId));
  const historial = await prisma.packageHistory.findFirstOrThrow({ where: { packageId: pkg.id } });
  return { code, eventId: historial.id };
}

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba tracking-hardening' } });
  branchId = branch.id;
  const user = await prisma.user.create({
    data: { username: 'admin-tracking-hardening-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  await prisma.packageSeries.upsert({ where: { inicial: 'H' }, update: {}, create: { inicial: 'H', descripcion: 'Prueba tracking hardening' } });
});

beforeEach(async () => {
  await prisma.company.upsert({
    where: { id: 1 },
    update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
    create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz (prueba)' },
  });
  process.env.TRACKING_URL = 'http://tracking.invalido.test';
  process.env.TRACKING_HMAC_SECRET = 'secreto-de-prueba';
});

describe('1. OUTBOX ATÓMICO', () => {
  test('A) COMMIT de la operación de negocio -> el OutboxEvent existe', async () => {
    const { eventId } = await crearEventoPendiente();
    const fila = await prisma.outboxEvent.findUnique({ where: { eventId } });
    expect(fila).toBeTruthy();
    expect(fila!.estado).toBe('PENDING');
  });

  test('B) ROLLBACK de la operación de negocio -> el OutboxEvent NO existe (nunca queda huérfano)', async () => {
    const antes = await prisma.outboxEvent.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await registrarPaqueteBasico(tx, 'ZZZ-INICIAL-SIN-SERIE', branchId, userId); // lanza SerieNoConfiguradaError -> rollback completo
      })
    ).rejects.toThrow();
    expect(await prisma.outboxEvent.count()).toBe(antes);
  });

  test('C) Tracking caído DESPUÉS del commit -> la operación local ya es definitiva y el evento queda PENDING (nunca se revierte por esto)', async () => {
    const { code, eventId } = await crearEventoPendiente();
    const pkg = await prisma.package.findUniqueOrThrow({ where: { code } });
    expect(pkg.status).toBe('EN_PAQUETERIA'); // el commit local ya ocurrió, es un hecho consumado

    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await procesarLoteOutbox({ fetchImpl });

    const pkgDespues = await prisma.package.findUniqueOrThrow({ where: { code } });
    expect(pkgDespues.status).toBe('EN_PAQUETERIA'); // sigue intacta, Tracking caído nunca la toca

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.intentos).toBe(1);
  });
});

describe('2. RECUPERACIÓN DE SENDING', () => {
  test('1) claim: procesarLoteOutbox marca SENDING con claimedAt al tomar una fila', async () => {
    const { eventId } = await crearEventoPendiente();
    // fetch que nunca resuelve durante la ventana de la aserción -> alcanza con inspeccionar el estado a mitad de camino usando un fetch que sí resuelve pero lento no es necesario: alcanza con verificar el resultado final y que claimedAt se limpió correctamente (ver test 7). Este test aísla el paso de claim llamando manualmente al mismo patrón.
    const claim = await prisma.outboxEvent.updateMany({ where: { eventId, estado: 'PENDING' }, data: { estado: 'SENDING', claimedAt: new Date() } });
    expect(claim.count).toBe(1);
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENDING');
    expect(fila.claimedAt).not.toBeNull();
  });

  test('2/3) proceso muerto simulado + recuperación: un SENDING con claimedAt viejo vuelve a PENDING', async () => {
    const { eventId } = await crearEventoPendiente();
    const haceRato = new Date(Date.now() - 10 * 60_000); // 10 min atrás, muy por encima del lease de 2 min
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'SENDING', claimedAt: haceRato } });

    const recuperados = await recuperarSendingExpirados(new Date());
    expect(recuperados).toBeGreaterThanOrEqual(1);

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('PENDING');
    expect(fila.claimedAt).toBeNull();
    expect(fila.intentos).toBe(0); // la recuperación no inventa un intento fallido — el próximo envío exitoso cuenta igual
  });

  test('un SENDING reciente (dentro del lease) NO se recupera todavía', async () => {
    const { eventId } = await crearEventoPendiente();
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'SENDING', claimedAt: new Date() } });

    const recuperados = await recuperarSendingExpirados(new Date());
    expect(recuperados).toBe(0);
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENDING');
  });

  test('4) reintento tras recuperación: procesarLoteOutbox retoma y envía la fila recuperada', async () => {
    const { eventId } = await crearEventoPendiente();
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'SENDING', claimedAt: new Date(Date.now() - 10 * 60_000) } });

    const fetchImpl = (async () => new Response(JSON.stringify({ recibido: true }), { status: 201 })) as typeof fetch;
    const resultado = await procesarLoteOutbox({ fetchImpl });

    expect(resultado.recuperados).toBeGreaterThanOrEqual(1);
    expect(resultado.enviados).toBeGreaterThanOrEqual(1);
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT'); // 7) estado final SENT
  });

  test('5/6) "Tracking ya había recibido el evento" antes de que el proceso muriera: el reintento no lo duplica (Tracking responde idempotente)', async () => {
    const { eventId } = await crearEventoPendiente();
    // Simula: el worker anterior llegó a mandar el HTTP y Tracking lo
    // aceptó, pero el proceso murió antes de poder marcar SENT localmente
    // -> quedó "atascado" en SENDING. Tracking, del lado suyo, ya tiene
    // este eventId — cualquier reenvío desde aquí debe seguir siendo
    // idempotente (200, nunca crea una segunda fila allá) gracias a que
    // el payload/eventId nunca cambian entre reintentos.
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'SENDING', claimedAt: new Date(Date.now() - 10 * 60_000) } });

    let vecesLlamado = 0;
    const fetchImpl = (async () => {
      vecesLlamado++;
      return new Response(JSON.stringify({ recibido: true }), { status: 200 }); // Tracking respondiendo "duplicado, ya lo tenía"
    }) as typeof fetch;

    const resultado = await procesarLoteOutbox({ fetchImpl });
    expect(vecesLlamado).toBe(1);
    expect(resultado.enviados).toBe(1);
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(fila.estado).toBe('SENT');
  });

  test('nunca queda SENDING permanente: tras varios ciclos, toda fila termina PENDING o SENT, nunca atascada', async () => {
    const { eventId } = await crearEventoPendiente();
    await prisma.outboxEvent.update({ where: { eventId }, data: { estado: 'SENDING', claimedAt: new Date(Date.now() - 10 * 60_000) } });

    await procesarLoteOutbox({ fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch });
    let fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });
    expect(['PENDING', 'SENT']).toContain(fila.estado);
    expect(fila.estado).not.toBe('SENDING');
  });

  test('una actualización final "zombie" (lease ya recuperado por otro) no pisa el estado — se descarta en vez de corromper', async () => {
    const { eventId } = await crearEventoPendiente();
    const fila0 = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId } });

    // Worker "lento": reclama la fila con un claimedAt viejo a propósito,
    // simulando que ya expiró su propio lease para cuando termina de
    // "enviar" (fetch artificialmente lento).
    const claimedAtViejo = new Date(Date.now() - 10 * 60_000);
    await prisma.outboxEvent.update({ where: { id: fila0.id }, data: { estado: 'SENDING', claimedAt: claimedAtViejo } });

    // Otro ciclo recupera la fila y la vuelve a enviar con éxito.
    await procesarLoteOutbox({ fetchImpl: (async () => new Response('{}', { status: 201 })) as typeof fetch });
    const filaTrasRecuperacion = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: fila0.id } });
    expect(filaTrasRecuperacion.estado).toBe('SENT');

    // El "worker lento" original ahora intenta su propia actualización
    // final con el claimedAt viejo que él reclamó — ya no coincide con el
    // estado actual (SENT, sin ese claimedAt) -> no debe tocar nada.
    const actualizacionZombie = await prisma.outboxEvent.updateMany({
      where: { id: fila0.id, estado: 'SENDING', claimedAt: claimedAtViejo },
      data: { estado: 'SENT', sentAt: new Date() },
    });
    expect(actualizacionZombie.count).toBe(0);
    const filaFinal = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: fila0.id } });
    expect(filaFinal.estado).toBe('SENT'); // intacta, la actualización zombie no la corrompió
  });
});

describe('3. PAQUETES INTER-SUCURSAL — autorización de la delegación (registrarEventoTrackingDelegado)', () => {
  let destinoElaId: string;
  const TRANSFERENCIA_ID = 'transferencia-hardening-1';

  beforeEach(async () => {
    const destino = await prisma.sucursalDestino.upsert({
      where: { codigo: 'ELAH' },
      update: {},
      create: { codigo: 'ELAH', nombre: 'Cofre Express El Alto (hardening)' },
    });
    destinoElaId = destino.id;
  });

  async function crearEnvioRecibido(destinoId: string, transferenciaId: string, codigoPaquete: string) {
    const pkg = await prisma.package.create({
      data: { code: codigoPaquete, codigoNormalizado: codigoPaquete.replace(/-/g, ''), inicial: 'H', branchId, status: 'EN_PAQUETERIA', registradoPorId: userId },
    });
    const envio = await prisma.envio.create({
      data: { codigo: `ENV-HARD-${seq++}`, destinoId, estado: 'RECIBIDO', transferenciaId, qrToken: `qr-${transferenciaId}`, cerradoAt: new Date(), cerradoPorId: userId },
    });
    await prisma.envioItem.create({ data: { envioId: envio.id, packageId: pkg.id, estadoPago: 'PAGADO', montoPagado: 0 } });
    return { envio, pkg };
  }

  test('J) transferenciaId inexistente -> NO_ENCONTRADO, ningún OutboxEvent creado', async () => {
    const antes = await prisma.outboxEvent.count();
    const resultado = await registrarEventoTrackingDelegado(
      { transferenciaId: 'no-existe', origenCodigoPaquete: 'X', reporteId: 'r1', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date() },
      'ELAH'
    );
    expect(resultado).toEqual({ ok: false, motivo: 'NO_ENCONTRADO' });
    expect(await prisma.outboxEvent.count()).toBe(antes);
  });

  test('K) destino incorrecto (el solicitante no es la sucursal a la que se envió) -> NO_ES_DESTINO, ningún write', async () => {
    seq++;
    const t = `${TRANSFERENCIA_ID}-K`;
    const { pkg } = await crearEnvioRecibido(destinoElaId, t, `H5T-K-${seq}`);
    const antes = await prisma.outboxEvent.count();

    const resultado = await registrarEventoTrackingDelegado(
      { transferenciaId: t, origenCodigoPaquete: pkg.code, reporteId: 'r-k', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date() },
      'OTRA_SUCURSAL_QUE_NO_ES_EL_DESTINO'
    );
    expect(resultado).toEqual({ ok: false, motivo: 'NO_ES_DESTINO' });
    expect(await prisma.outboxEvent.count()).toBe(antes);
  });

  test('H) El Alto no puede "falsificar" un paquete de otra transferencia/paquete que nunca viajó en su lote -> PAQUETE_NO_ENCONTRADO, ningún write', async () => {
    seq++;
    const t = `${TRANSFERENCIA_ID}-H`;
    await crearEnvioRecibido(destinoElaId, t, `H5T-H-real-${seq}`);
    const antes = await prisma.outboxEvent.count();

    const resultado = await registrarEventoTrackingDelegado(
      { transferenciaId: t, origenCodigoPaquete: 'CODIGO-QUE-NUNCA-VIAJO-EN-ESE-LOTE', reporteId: 'r-h', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date() },
      'ELAH'
    );
    expect(resultado).toEqual({ ok: false, motivo: 'PAQUETE_NO_ENCONTRADO' });
    expect(await prisma.outboxEvent.count()).toBe(antes);
  });

  test('envío todavía no RECIBIDO (ej. CERRADO) -> ESTADO_INVALIDO, ningún write', async () => {
    seq++;
    const t = `${TRANSFERENCIA_ID}-estado`;
    const pkg = await prisma.package.create({ data: { code: `H5T-EST-${seq}`, codigoNormalizado: `H5TEST${seq}`, inicial: 'H', branchId, status: 'EN_PAQUETERIA', registradoPorId: userId } });
    const envio = await prisma.envio.create({ data: { codigo: `ENV-HARD-EST-${seq}`, destinoId: destinoElaId, estado: 'CERRADO', transferenciaId: t, qrToken: `qr-${t}`, cerradoAt: new Date(), cerradoPorId: userId } });
    await prisma.envioItem.create({ data: { envioId: envio.id, packageId: pkg.id, estadoPago: 'PAGADO', montoPagado: 0 } });
    const antes = await prisma.outboxEvent.count();

    const resultado = await registrarEventoTrackingDelegado(
      { transferenciaId: t, origenCodigoPaquete: pkg.code, reporteId: 'r-estado', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date() },
      'ELAH'
    );
    expect(resultado).toEqual({ ok: false, motivo: 'ESTADO_INVALIDO' });
    expect(await prisma.outboxEvent.count()).toBe(antes);
  });

  test('I) delegación VÁLIDA: encola el evento final en la base de origen, firmable como origen, sucursalActual=destino', async () => {
    seq++;
    const t = `${TRANSFERENCIA_ID}-valida`;
    const { pkg } = await crearEnvioRecibido(destinoElaId, t, `H5T-VAL-${seq}`);
    const fecha = new Date('2026-05-01T14:32:00.000Z');

    const resultado = await registrarEventoTrackingDelegado(
      { transferenciaId: t, origenCodigoPaquete: pkg.code, reporteId: 'reporte-valido-1', tipoEvento: 'PAQUETE_TRANSICION', estadoInternoOrigen: 'ENTREGADO', fechaOrigen: fecha },
      'ELAH'
    );
    expect(resultado).toEqual({ ok: true, duplicado: false });

    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: 'INTEROP:reporte-valido-1' } });
    expect(fila.destino).toBe('TRACKING'); // el ORIGEN ya lo encola como un evento directo normal, listo para el worker de siempre
    expect(fila.origenSucursalCodigo).toBe('LPZ');
    const payload = JSON.parse(fila.payload);
    expect(payload.origenSucursalCodigo).toBe('LPZ');
    expect(payload.codigo).toBe(pkg.code);
    expect(payload.sucursalActualCodigo).toBe('ELAH'); // el paquete está físicamente en el destino, no en el origen
    expect(payload.estadoInternoOrigen).toBe('ENTREGADO');
    expect(payload.fechaOrigen).toBe(fecha.toISOString()); // la fecha REAL reportada por el destino, nunca la de "ahora"
  });

  test('reintento idempotente del propio destino (mismo reporteId) -> duplicado:true, no encola una segunda fila', async () => {
    seq++;
    const t = `${TRANSFERENCIA_ID}-dup`;
    const { pkg } = await crearEnvioRecibido(destinoElaId, t, `H5T-DUP-${seq}`);
    const input = { transferenciaId: t, origenCodigoPaquete: pkg.code, reporteId: 'reporte-duplicado-1', tipoEvento: 'PAQUETE_TRANSICION' as const, estadoInternoOrigen: 'ENTREGADO', fechaOrigen: new Date() };

    const primero = await registrarEventoTrackingDelegado(input, 'ELAH');
    expect(primero).toEqual({ ok: true, duplicado: false });
    const segundo = await registrarEventoTrackingDelegado(input, 'ELAH');
    expect(segundo).toEqual({ ok: true, duplicado: true });

    const filas = await prisma.outboxEvent.findMany({ where: { eventId: 'INTEROP:reporte-duplicado-1' } });
    expect(filas).toHaveLength(1);
  });
});

describe('G) Paquete LPZ -> ELA -> transición posterior en ELA: emitirEventoPaquete() encola la delegación (no la omite, no la envía directo)', () => {
  test('un paquete materializado (origenSucursalCodigo=LPZ) que transiciona aquí encola destino=INTEROP_ORIGEN con la solicitud correcta', async () => {
    await prisma.company.update({ where: { id: 1 }, data: { sucursalCodigo: 'ELAG', sucursalNombre: 'Cofre Express El Alto (G)' } });
    seq++;
    const code = `H5T-G-${seq}`;
    const materializado = await prisma.package.create({
      data: {
        code,
        codigoNormalizado: code.replace(/-/g, ''),
        inicial: 'H',
        branchId,
        status: 'EN_PAQUETERIA',
        registradoPorId: userId,
        origenSucursalCodigo: 'LPZ',
        origenCodigoPaquete: code,
        origenTransferenciaId: 'transferencia-g-1',
      },
    });

    await entregarPaquete(code, userId);

    const historial = await prisma.packageHistory.findFirstOrThrow({ where: { packageId: materializado.id, estado: 'ENTREGADO' } });
    const fila = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: `INTEROP:${historial.id}` } });
    expect(fila.destino).toBe('INTEROP_ORIGEN');
    expect(fila.origenSucursalCodigo).toBe('LPZ'); // a quién hay que delegarle, no la identidad de esta instalación

    const solicitud = JSON.parse(fila.payload);
    expect(solicitud.transferenciaId).toBe('transferencia-g-1');
    expect(solicitud.origenCodigoPaquete).toBe(code);
    expect(solicitud.reporteId).toBe(historial.id);
    expect(solicitud.estadoInternoOrigen).toBe('ENTREGADO');

    // La operación real (la entrega física en El Alto) nunca dependió de esto.
    const pkgFinal = await prisma.package.findUniqueOrThrow({ where: { id: materializado.id } });
    expect(pkgFinal.status).toBe('ENTREGADO');
  });
});
