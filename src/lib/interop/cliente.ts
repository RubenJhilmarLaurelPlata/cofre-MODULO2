// src/lib/interop/cliente.ts
// Fase 4.3: cliente HTTP SALIENTE reutilizable para consultar un Envío en
// otra instalación. No conoce React/Next (usa el `fetch` global de Node,
// inyectable para pruebas) ni Prisma — quien lo llama ya resolvió
// apiUrlSaliente/apiKeySaliente desde su propio SucursalDestino (Fase 4.1).
import { crearHeadersInterop } from './headers';
import type { EnvioInteropDTO } from './dto';

export class EnvioInteropNoEncontradoError extends Error {
  constructor(codigo: string) {
    super(`La instalación remota no tiene ningún envío con el código "${codigo}" (o no está disponible para consultarse).`);
    this.name = 'EnvioInteropNoEncontradoError';
  }
}
export class EnvioInteropNoAutorizadoError extends Error {
  constructor(status: number) {
    super(`La instalación remota rechazó la autenticación de esta consulta (HTTP ${status}).`);
    this.name = 'EnvioInteropNoAutorizadoError';
  }
}
export class EnvioInteropRespuestaInvalidaError extends Error {
  constructor(status: number) {
    super(`La instalación remota respondió de forma inesperada (HTTP ${status}).`);
    this.name = 'EnvioInteropRespuestaInvalidaError';
  }
}

export interface ConsultarEnvioRemotoInput {
  /** URL base de la instalación remota, ej. "https://elalto.cofreexpress.example" (SucursalDestino.apiUrlSaliente). */
  apiUrlSaliente: string;
  /** Envio.codigo a consultar, ej. "ENV-20260904-001". */
  codigo: string;
  /** Secreto de ESTA instalación para llamar a esa otra (SucursalDestino.apiKeySaliente) — nunca se expone en la URL. */
  apiKeySaliente: string;
  /** Código de ESTA instalación (Company.sucursalCodigo) — viaja en X-Cofre-Sucursal. */
  sucursalCodigo: string;
  /** Inyectable para pruebas (mock de `fetch`) — por defecto, el `fetch` global. */
  fetchImpl?: typeof fetch;
}

/**
 * GET autenticado a `{apiUrlSaliente}/api/interop/envios/{codigo}`. El
 * `path` usado para firmar es exactamente el mismo que se usa en la URL
 * real (sin query string, ver README.md) — necesario para que el
 * servidor remoto pueda reconstruir el mismo canonical string a partir
 * de `req.nextUrl.pathname`.
 */
export async function consultarEnvioRemoto(input: ConsultarEnvioRemotoInput): Promise<EnvioInteropDTO> {
  const path = `/api/interop/envios/${encodeURIComponent(input.codigo)}`;
  const url = new URL(path, input.apiUrlSaliente).toString();
  const headers = crearHeadersInterop({
    sucursalCodigo: input.sucursalCodigo,
    secreto: input.apiKeySaliente,
    method: 'GET',
    path,
    body: '',
  });

  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(url, { method: 'GET', headers });

  if (res.status === 404) throw new EnvioInteropNoEncontradoError(input.codigo);
  if (res.status === 401 || res.status === 403) throw new EnvioInteropNoAutorizadoError(res.status);
  if (!res.ok) throw new EnvioInteropRespuestaInvalidaError(res.status);

  return (await res.json()) as EnvioInteropDTO;
}

export interface RecibirEnvioRemotoInput {
  /** URL base de la instalación remota (SucursalDestino.apiUrlSaliente). */
  apiUrlSaliente: string;
  /** Envio.codigo del lote a recibir. */
  codigo: string;
  /** qrToken leído del QR físico — nunca uno recibido previamente por otra vía. */
  qrToken: string;
  /** apiKeySaliente de ESTA instalación para llamar a esa otra. */
  apiKeySaliente: string;
  /** Código de ESTA instalación — viaja en X-Cofre-Sucursal. */
  sucursalCodigo: string;
  fetchImpl?: typeof fetch;
}

/**
 * POST autenticado a `{apiUrlSaliente}/api/interop/envios/{codigo}/recibir`
 * con `{ qrToken }` como único campo del body — nunca en la URL/query
 * string (ver README.md). La firma cubre el body EXACTO que se envía: se
 * serializa una sola vez (`body`) y esa misma cadena se usa tanto para
 * firmar como para el `fetch` real, para que nunca puedan divergir por un
 * segundo `JSON.stringify` con un resultado distinto.
 */
export async function recibirEnvioRemoto(input: RecibirEnvioRemotoInput): Promise<EnvioInteropDTO> {
  const path = `/api/interop/envios/${encodeURIComponent(input.codigo)}/recibir`;
  const url = new URL(path, input.apiUrlSaliente).toString();
  const body = JSON.stringify({ qrToken: input.qrToken });
  const headers = crearHeadersInterop({
    sucursalCodigo: input.sucursalCodigo,
    secreto: input.apiKeySaliente,
    method: 'POST',
    path,
    body,
  });

  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });

  if (res.status === 404) throw new EnvioInteropNoEncontradoError(input.codigo);
  if (res.status === 401 || res.status === 403) throw new EnvioInteropNoAutorizadoError(res.status);
  if (!res.ok) throw new EnvioInteropRespuestaInvalidaError(res.status);

  return (await res.json()) as EnvioInteropDTO;
}
