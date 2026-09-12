// src/lib/tracking/cliente.ts
// Fase 5.3L: cliente HTTP saliente hacia cofre-tracking. Reutiliza
// EXACTAMENTE el mismo protocolo HMAC ya construido en src/lib/interop/
// (Fase 4.2) — nunca reimplementa firma/canonicalizacion: cofre-tracking
// porto ese mismo protocolo tal cual (ver su src/lib/hmac/, mismos
// nombres de cabecera). NUNCA lanza: siempre devuelve un resultado, para
// que el worker decida que hacer sin try/catch alrededor de cada
// llamada, y para que ningun mensaje de error guardado en
// OutboxEvent.lastError pueda terminar incluyendo el secreto HMAC (nunca
// se propaga el error crudo, solo un motivo corto ya clasificado aqui).
import { crearHeadersInterop } from '@/lib/interop/headers';
import { obtenerConfigTracking } from './config';

export type ResultadoEnvioTracking = { ok: true } | { ok: false; motivo: 'NO_CONFIGURADO' | 'RED' | 'RECHAZADO'; detalle: string };

export interface EnviarEventoInput {
  /** Ya serializado (el mismo string guardado en OutboxEvent.payload) — nunca se reconstruye distinto para firmar vs para enviar, para que ambos no puedan divergir. */
  payloadJson: string;
  /**
   * Codigo de ESTA instalacion para firmar (X-Cofre-Sucursal) — en la
   * practica siempre OutboxEvent.origenSucursalCodigo, que por
   * construccion (ver src/lib/tracking/eventos.ts) SIEMPRE coincide con
   * la identidad de la instalacion que creo la fila: cofre-tracking
   * rechaza (403) cualquier evento cuyo origen declarado no coincida con
   * quien lo firma, asi que un evento nunca se encola aqui si la firma
   * no fuera a coincidir.
   */
  sucursalCodigoFirmante: string;
  /** Inyectable para pruebas (mock de `fetch`) — por defecto, el `fetch` global. */
  fetchImpl?: typeof fetch;
}

const PATH_EVENTOS = '/tracking/events';

export async function enviarEventoATracking(input: EnviarEventoInput): Promise<ResultadoEnvioTracking> {
  const config = obtenerConfigTracking();
  if (!config) return { ok: false, motivo: 'NO_CONFIGURADO', detalle: 'TRACKING_URL/TRACKING_HMAC_SECRET no configurados en esta instalación.' };

  const url = new URL(PATH_EVENTOS, config.url).toString();
  const headers = crearHeadersInterop({
    sucursalCodigo: input.sucursalCodigoFirmante,
    secreto: config.secreto,
    method: 'POST',
    path: PATH_EVENTOS,
    body: input.payloadJson,
  });

  const fetchFn = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: input.payloadJson });
  } catch (err) {
    return { ok: false, motivo: 'RED', detalle: err instanceof Error ? err.message : 'Error de red desconocido.' };
  }

  if (res.ok) return { ok: true };
  return { ok: false, motivo: 'RECHAZADO', detalle: `HTTP ${res.status}` };
}
