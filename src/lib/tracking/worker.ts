// src/lib/tracking/worker.ts
// Fase 5.3H/I/J + Fase 5.3-HARDENING: procesa el Outbox local, fuera de
// cualquier request de usuario — nunca bloquea una operacion real
// (registrar/entregar/etc.): esas ya terminaron y confirmaron (commit)
// antes de que este worker exista siquiera. Pensado para correr en un
// intervalo corto (ver scripts/tracking-worker.ts) — cada llamada procesa
// un lote chico y termina; nunca un bucle de reintento DENTRO de un mismo
// request (Fase 5.3I, antipatron explicitamente prohibido:
// `while(...) fetch(...)` bloqueando la respuesta al usuario).
import { prisma } from '@/lib/prisma';
import { enviarEventoATracking } from './cliente';
import { enviarDelegacionAOrigen } from './cliente-interop';
import type { OutboxEvent } from '@prisma/client';

const LIMITE_LOTE_DEFAULT = 20;
const BASE_DELAY_MS = 10_000; // 10s
const MAX_DELAY_MS = 30 * 60_000; // 30 min

// Fase 5.3-HARDENING: tope de arrendamiento (lease) de un SENDING. Muy
// por encima de lo que debería tardar una sola llamada HTTP real (unos
// pocos segundos) — un SENDING que lleva más que esto casi seguro
// significa que el proceso que lo reclamó murió (o quedó colgado) antes
// de poder actualizar el estado final, nunca que "todavía está en
// camino". Ver recuperarSendingExpirados() más abajo.
const LEASE_TIMEOUT_MS = 2 * 60_000; // 2 min

/**
 * Backoff exponencial ACOTADO: 10s, 20s, 40s, 80s, ... hasta un tope de
 * 30min — nunca crece sin límite (Fase 5.3I). `intentos` ya viene
 * incrementado (1 en el primer fallo) cuando se llama a esto.
 */
export function calcularNextAttempt(intentos: number, ahora: Date): Date {
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, intentos - 1));
  return new Date(ahora.getTime() + delay);
}

/** Trunca por las dudas — nunca deberia contener el secreto HMAC (los clientes de esta carpeta ya solo devuelven motivos cortos clasificados, nunca el error crudo/cabeceras). */
function mensajeErrorSeguro(motivo: string, detalle: string): string {
  return `${motivo}: ${detalle}`.slice(0, 500);
}

/**
 * Fase 5.3-HARDENING (recuperación de SENDING huérfano): vuelve a PENDING
 * cualquier fila cuyo "claimedAt" supere LEASE_TIMEOUT_MS — nunca borra
 * "intentos" ni "payload", así que el próximo claim la retoma
 * exactamente donde se quedó. Se corre siempre ANTES de seleccionar
 * candidatos nuevos, en cada llamada a procesarLoteOutbox(): así un
 * proceso que murió entre el claim y la actualización final nunca deja
 * la fila bloqueada para siempre — algún worker posterior (el mismo
 * proceso reiniciado, u otro) eventualmente la recupera. `eventId` sigue
 * siendo la única garantía real de que un reenvío después de esto nunca
 * duplique el evento en Tracking (ver README de esta carpeta).
 */
export async function recuperarSendingExpirados(ahora: Date): Promise<number> {
  const limite = new Date(ahora.getTime() - LEASE_TIMEOUT_MS);
  const resultado = await prisma.outboxEvent.updateMany({
    where: { estado: 'SENDING', claimedAt: { lt: limite } },
    data: { estado: 'PENDING', claimedAt: null },
  });
  return resultado.count;
}

async function enviar(evento: OutboxEvent, fetchImpl?: typeof fetch) {
  if (evento.destino === 'INTEROP_ORIGEN') {
    return enviarDelegacionAOrigen({ origenSucursalCodigo: evento.origenSucursalCodigo, payloadJson: evento.payload, fetchImpl });
  }
  return enviarEventoATracking({ payloadJson: evento.payload, sucursalCodigoFirmante: evento.origenSucursalCodigo, fetchImpl });
}

export interface ResultadoLoteOutbox {
  procesados: number;
  enviados: number;
  fallidos: number;
  recuperados: number;
}

/**
 * Procesa un lote de eventos PENDING listos (nextAttemptAt <= ahora).
 *
 * Concurrencia (Fase 5.3J) + recuperación de lease (Fase 5.3-HARDENING):
 *
 * 1. Primero se recuperan los SENDING expirados (ver
 *    recuperarSendingExpirados()) — vuelven a PENDING y quedan
 *    disponibles para el claim normal de este mismo ciclo.
 * 2. El "claim" de cada fila candidata es un
 *    `updateMany({where: {id, estado:'PENDING'}, data: {estado:'SENDING', claimedAt: ahora}})`
 *    — mismo patrón optimista ya usado en transicionar()/cerrarEnvio()/
 *    recibirEnvio() (where con el estado anterior exacto). Si dos workers
 *    leen la misma fila PENDING casi al mismo tiempo, sus dos updateMany
 *    compiten por la MISMA fila bajo connection_limit=1 (se serializan
 *    solos): solo uno encuentra count=1 y continúa; el otro encuentra
 *    count=0 y la salta sin reenviar nada. No hace falta Redis ni
 *    infraestructura adicional.
 * 3. La actualización FINAL (tras el intento de envío) está condicionada
 *    al MISMO claimedAt que este worker escribió al reclamarla
 *    (`where: {id, estado:'SENDING', claimedAt: <valor exacto del claim>}`).
 *    Si otro proceso ya la recuperó por lease expirado (y quizás otro
 *    worker ya la reclamó de nuevo) mientras este envío estaba en vuelo,
 *    esta actualización encuentra count=0 y NO TOCA la fila — evita que
 *    un worker "zombie" pise el resultado de quien la reclamó después.
 *    Tracking es idempotente por eventId de todas formas (doble defensa),
 *    pero esto evita además el trabajo/red desperdiciada de un envío
 *    duplicado.
 */
export async function procesarLoteOutbox(opts?: { limite?: number; fetchImpl?: typeof fetch; ahora?: Date }): Promise<ResultadoLoteOutbox> {
  const ahora = opts?.ahora ?? new Date();
  const limite = opts?.limite ?? LIMITE_LOTE_DEFAULT;

  const recuperados = await recuperarSendingExpirados(ahora);

  const candidatos = await prisma.outboxEvent.findMany({
    where: { estado: 'PENDING', nextAttemptAt: { lte: ahora } },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  let enviados = 0;
  let fallidos = 0;

  for (const evento of candidatos) {
    const claimedAt = ahora;
    const claim = await prisma.outboxEvent.updateMany({ where: { id: evento.id, estado: 'PENDING' }, data: { estado: 'SENDING', claimedAt } });
    if (claim.count === 0) continue; // Otro worker ya la tomo.

    const resultado = await enviar(evento, opts?.fetchImpl);

    if (resultado.ok) {
      const actualizado = await prisma.outboxEvent.updateMany({
        where: { id: evento.id, estado: 'SENDING', claimedAt },
        data: { estado: 'SENT', claimedAt: null, sentAt: new Date(), lastError: null },
      });
      if (actualizado.count === 1) enviados++; // count=0: el lease se recuperó bajo nuestros pies — ver comentario de arriba, no se toca nada más.
    } else {
      const intentos = evento.intentos + 1;
      const actualizado = await prisma.outboxEvent.updateMany({
        where: { id: evento.id, estado: 'SENDING', claimedAt },
        data: {
          estado: 'PENDING',
          claimedAt: null,
          intentos,
          nextAttemptAt: calcularNextAttempt(intentos, ahora),
          lastError: mensajeErrorSeguro(resultado.motivo, resultado.detalle),
        },
      });
      if (actualizado.count === 1) fallidos++;
    }
  }

  return { procesados: candidatos.length, enviados, fallidos, recuperados };
}
