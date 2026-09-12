// src/lib/tracking/eventos.ts
// Fase 5.3: construccion del payload publico + insercion atomica en el
// Outbox local (OutboxEvent) — nunca llama a la red desde aqui (eso es
// src/lib/tracking/worker.ts, siempre DESPUES de que la transaccion de
// negocio ya hizo commit). Cada funcion de este archivo se llama DENTRO
// de la MISMA transaccion (`tx`) que ya esta escribiendo el cambio real
// (Package/PackageHistory/Envio) — Fase 5.3D: el evento nunca se inserta
// en una transaccion separada; si la operacion real revierte, este
// insert revierte con ella.
import type { Prisma } from '@prisma/client';
import { obtenerIdentidadInstalacion, resolverIdentidadPaquete, type PaqueteParaIdentidad } from './identidad';

export type TipoEventoTracking = 'PAQUETE_REGISTRADO' | 'PAQUETE_TRANSICION' | 'ENVIO_CERRADO' | 'ENVIO_RECIBIDO';

/** Forma EXACTA que espera POST /tracking/events de cofre-tracking (Fase 5.2) — ver ese repo, src/app/tracking/events/route.ts. */
export interface PayloadEventoTracking {
  eventId: string;
  origenSucursalCodigo: string;
  origenSucursalNombre: string;
  codigo: string;
  tipoEvento: TipoEventoTracking;
  estadoInternoOrigen: string;
  fechaOrigen: string;
  sucursalActualCodigo: string;
  sucursalActualNombre: string;
  destinoSucursalCodigo?: string;
  destinoSucursalNombre?: string;
}

/**
 * Forma del body que ESTA instalación (el destino de una transferencia)
 * envía a la instalación de ORIGEN cuando no puede firmar un evento ella
 * misma (Fase 5.3-HARDENING, ver informe sección 3) — nunca el payload
 * final de Tracking, que arma y firma el ORIGEN al recibir esto (ver
 * src/lib/interop-envios.ts, registrarEventoTrackingDelegado()).
 */
export interface SolicitudDelegacionTracking {
  /** Envio.transferenciaId de la instalación de ORIGEN — el origen usa esto para validar que el solicitante es realmente el destino de ESE envío (nunca confía en el campo declarado por sí solo, ver interop-envios.ts). */
  transferenciaId: string;
  /** Package.code tal como lo conoce el ORIGEN (= Package.origenCodigoPaquete en esta instalación). */
  origenCodigoPaquete: string;
  /** PackageHistory.id LOCAL (de esta instalación) de la transición que se reporta — se vuelve el eventId en el origen (namespaced), estable en cualquier reintento (Fase 5.3F). */
  reporteId: string;
  tipoEvento: 'PAQUETE_TRANSICION';
  estadoInternoOrigen: string;
  fechaOrigen: string;
}

interface EmitirEventoPaqueteInput {
  tipoEvento: 'PAQUETE_REGISTRADO' | 'PAQUETE_TRANSICION';
  /** Reutiliza PackageHistory.id de la fila que este mismo evento describe — nunca un uuid nuevo (Fase 5.3F: estable en cualquier reintento). */
  eventId: string;
  pkg: PaqueteParaIdentidad;
  estadoInternoOrigen: string;
  /** Fecha REAL de la operacion de origen (nunca la de un reintento posterior — Fase 5.3G). */
  fechaOrigen: Date;
  /**
   * Override de "sucursalActual" (Fase 5.3-HARDENING): quién tiene el
   * paquete FÍSICAMENTE en este momento, cuando difiere de la identidad
   * de origen resuelta — el único caso hoy es un evento DELEGADO (el
   * origen reportando, en su propio nombre, una transición ocurrida en
   * el destino). Si se omite, sigue siendo la identidad de origen (el
   * comportamiento de siempre: el paquete no se movió de edificio).
   */
  sucursalActual?: { codigo: string; nombre: string };
}

/**
 * PAQUETE_REGISTRADO / PAQUETE_TRANSICION.
 *
 * Fase 5.3-HARDENING (paquetes inter-sucursal — ver informe, sección 3):
 * si el paquete es uno materializado aquí por una transferencia real
 * (origenSucursalCodigo != identidad de ESTA instalación), esta
 * instalación NO PUEDE firmar el evento final ante Tracking (que exige
 * que el firmante HMAC coincida exactamente con "origenSucursalCodigo"
 * del payload — regla de seguridad de Fase 5.1, deliberadamente
 * intacta). En vez de omitir el evento (limitación de la Fase 5.3
 * original), ahora se DELEGA: se encola una solicitud hacia la
 * instalación de ORIGEN (misma cola Outbox, discriminada por
 * `destino='INTEROP_ORIGEN'` — ver el modelo en schema.prisma), que esa
 * instalación valida y, si es legítima, emite ella misma el evento final
 * firmado como sí misma. Si el paquete no tiene `origenTransferenciaId`
 * (no debería ocurrir nunca en la práctica — todo paquete con
 * `origenSucursalCodigo` seteado lo tiene, ver materializarRecepcionRemota())
 * no hay forma de enrutar la delegación y el evento se omite, igual que
 * antes.
 */
export async function emitirEventoPaquete(tx: Prisma.TransactionClient, input: EmitirEventoPaqueteInput): Promise<void> {
  const instalacion = await obtenerIdentidadInstalacion(tx);
  if (!instalacion) return; // Instalación sin identidad de tracking configurada todavía.

  const identidad = await resolverIdentidadPaquete(tx, input.pkg, instalacion);

  if (identidad.origenSucursalCodigo !== instalacion.codigo) {
    // PAQUETE_REGISTRADO nunca debería llegar aquí en la práctica: un
    // paquete materializado por interop nace vía
    // materializarRecepcionRemota() (interop-envios.ts), que
    // deliberadamente NUNCA llama a emitirEventoPaquete() (su "alta" ya
    // está cubierta por el ENVIO_RECIBIDO que emite el origen) — pero se
    // guarda explícito en vez de asumirlo silenciosamente: solo
    // PAQUETE_TRANSICION tiene sentido delegar.
    if (input.tipoEvento !== 'PAQUETE_TRANSICION' || !input.pkg.origenTransferenciaId) return;
    await encolarDelegacionInterop(tx, {
      origenSucursalCodigo: identidad.origenSucursalCodigo,
      transferenciaId: input.pkg.origenTransferenciaId,
      origenCodigoPaquete: identidad.codigo,
      reporteId: input.eventId,
      tipoEvento: input.tipoEvento,
      estadoInternoOrigen: input.estadoInternoOrigen,
      fechaOrigen: input.fechaOrigen,
    });
    return;
  }

  const sucursalActual = input.sucursalActual ?? { codigo: identidad.origenSucursalCodigo, nombre: identidad.origenSucursalNombre };

  const payload: PayloadEventoTracking = {
    eventId: input.eventId,
    origenSucursalCodigo: identidad.origenSucursalCodigo,
    origenSucursalNombre: identidad.origenSucursalNombre,
    codigo: identidad.codigo,
    tipoEvento: input.tipoEvento,
    estadoInternoOrigen: input.estadoInternoOrigen,
    fechaOrigen: input.fechaOrigen.toISOString(),
    sucursalActualCodigo: sucursalActual.codigo,
    sucursalActualNombre: sucursalActual.nombre,
  };

  await tx.outboxEvent.create({
    data: {
      eventId: input.eventId,
      destino: 'TRACKING',
      tipoEvento: input.tipoEvento,
      origenSucursalCodigo: identidad.origenSucursalCodigo,
      payload: JSON.stringify(payload),
    },
  });
}

interface EncolarDelegacionInput {
  /** Company.sucursalCodigo de la instalación de ORIGEN a la que se delega. */
  origenSucursalCodigo: string;
  transferenciaId: string;
  origenCodigoPaquete: string;
  reporteId: string;
  tipoEvento: 'PAQUETE_TRANSICION';
  estadoInternoOrigen: string;
  fechaOrigen: Date;
}

/**
 * Encola (en la MISMA transacción del llamador — Fase 5.3D) una
 * solicitud de delegación hacia la instalación de origen. `eventId` local
 * = `INTEROP:${reporteId}` — namespaced para nunca colisionar con un
 * eventId "directo" de esta misma instalación, aunque en la práctica ya
 * serían tablas/bases distintas. El worker (ver worker.ts) la reconoce
 * por `destino='INTEROP_ORIGEN'` y la envía con el protocolo interop
 * (src/lib/tracking/cliente-interop.ts), nunca con TRACKING_HMAC_SECRET.
 */
async function encolarDelegacionInterop(tx: Prisma.TransactionClient, input: EncolarDelegacionInput): Promise<void> {
  const solicitud: SolicitudDelegacionTracking = {
    transferenciaId: input.transferenciaId,
    origenCodigoPaquete: input.origenCodigoPaquete,
    reporteId: input.reporteId,
    tipoEvento: input.tipoEvento,
    estadoInternoOrigen: input.estadoInternoOrigen,
    fechaOrigen: input.fechaOrigen.toISOString(),
  };

  await tx.outboxEvent.create({
    data: {
      eventId: `INTEROP:${input.reporteId}`,
      destino: 'INTEROP_ORIGEN',
      tipoEvento: input.tipoEvento,
      origenSucursalCodigo: input.origenSucursalCodigo,
      payload: JSON.stringify(solicitud),
    },
  });
}

interface EmitirEventoEnvioInput {
  tipoEvento: 'ENVIO_CERRADO' | 'ENVIO_RECIBIDO';
  /** Envio.transferenciaId si existe, o Envio.id como respaldo estable (envios anteriores a Fase 4.1, que quedaron con transferenciaId=null) — nunca un uuid nuevo en cada llamada. */
  claveEnvio: string;
  pkg: PaqueteParaIdentidad & { id: string };
  /** Envio.estado en el momento del evento ('CERRADO' | 'RECIBIDO'). */
  estadoInternoOrigen: string;
  fechaOrigen: Date;
  destino: { codigo: string; nombre: string };
}

/**
 * ENVIO_CERRADO / ENVIO_RECIBIDO: fan-out, UN evento por paquete del lote
 * (Tracking identifica paquetes individuales, nunca lotes/envios como
 * unidad publica). eventId deterministico = claveEnvio + packageId +
 * tipoEvento (Fase 5.3F) — nunca cambia entre reintentos, y nunca
 * colisiona entre dos paquetes del mismo lote ni entre CERRADO/RECIBIDO
 * del mismo paquete.
 *
 * "sucursalActual": quien tiene el paquete FISICAMENTE justo despues de
 * este evento — para ENVIO_CERRADO sigue siendo ESTA instalacion (el
 * paquete no se movio de edificio todavia, solo salio "en transito");
 * para ENVIO_RECIBIDO es el destino (convencion documentada en
 * cofre-tracking, src/lib/eventos.ts). Esto es correcto incluso en un
 * hipotetico reenvio de un paquete ya materializado por interop
 * (multi-hop): "esta instalacion" es siempre quien fisicamente ejecuta
 * cerrarEnvio()/recibirEnvio() en ese momento, sin importar de donde vino
 * el paquete originalmente.
 *
 * Igual que emitirEventoPaquete(), si el paquete no es nativo de esta
 * instalación (multi-hop: un paquete ya materializado por interop que se
 * reenvía a una TERCERA instalación), esta instalación tampoco puede
 * firmar el evento final — se delega de la misma forma.
 */
export async function emitirEventoEnvio(tx: Prisma.TransactionClient, input: EmitirEventoEnvioInput): Promise<void> {
  const instalacion = await obtenerIdentidadInstalacion(tx);
  if (!instalacion) return;

  const identidad = await resolverIdentidadPaquete(tx, input.pkg, instalacion);
  const eventId = `${input.claveEnvio}:${input.pkg.id}:${input.tipoEvento}`;

  if (identidad.origenSucursalCodigo !== instalacion.codigo) {
    if (!input.pkg.origenTransferenciaId) return;
    await encolarDelegacionInterop(tx, {
      origenSucursalCodigo: identidad.origenSucursalCodigo,
      transferenciaId: input.pkg.origenTransferenciaId,
      origenCodigoPaquete: identidad.codigo,
      reporteId: eventId,
      tipoEvento: 'PAQUETE_TRANSICION',
      estadoInternoOrigen: input.estadoInternoOrigen,
      fechaOrigen: input.fechaOrigen,
    });
    return;
  }

  const sucursalActual = input.tipoEvento === 'ENVIO_CERRADO' ? instalacion : input.destino;

  const payload: PayloadEventoTracking = {
    eventId,
    origenSucursalCodigo: identidad.origenSucursalCodigo,
    origenSucursalNombre: identidad.origenSucursalNombre,
    codigo: identidad.codigo,
    tipoEvento: input.tipoEvento,
    estadoInternoOrigen: input.estadoInternoOrigen,
    fechaOrigen: input.fechaOrigen.toISOString(),
    sucursalActualCodigo: sucursalActual.codigo,
    sucursalActualNombre: sucursalActual.nombre,
    destinoSucursalCodigo: input.destino.codigo,
    destinoSucursalNombre: input.destino.nombre,
  };

  await tx.outboxEvent.create({
    data: {
      eventId,
      destino: 'TRACKING',
      tipoEvento: input.tipoEvento,
      origenSucursalCodigo: identidad.origenSucursalCodigo,
      payload: JSON.stringify(payload),
    },
  });
}
