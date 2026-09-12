// src/lib/interop/verificar.ts
// Fase 4.2: verificación de un request ENTRANTE — el corazón de la capa
// de autenticación inter-sucursales. Deliberadamente NO conoce Next.js
// (no recibe un NextRequest): recibe strings/objetos planos ya
// extraídos, para poder probarse sin ningún servidor real y para que la
// futura ruta /api/interop/* (Fase 4.3) sea solo un adaptador delgado
// alrededor de esta función. Tampoco conoce Prisma: quién es una
// "sucursal válida" y cuál es su secreto se resuelve por el callback
// `resolverSecreto` que le pasa el llamador — ver README.md.
import { VENTANA_TIMESTAMP_SEGUNDOS_DEFAULT } from './constantes';
import { firmarRequest, compararTimingSafe } from './firma';
import { almacenNonceInteropPorDefecto, type AlmacenNonceInterop } from './nonce';

/**
 * Motivo de rechazo — deliberadamente distinguible por el llamador
 * (requisito explícito de esta fase: "diferenciar claramente sucursal
 * desconocida / timestamp inválido / nonce inválido-repetido / firma
 * inválida"). Nunca incluye el secreto ni la firma completa (ver
 * enmascarado.ts para cuando haga falta anotar algo en logs).
 */
export type MotivoRechazoInterop = 'SUCURSAL_DESCONOCIDA' | 'TIMESTAMP_INVALIDO' | 'NONCE_INVALIDO' | 'FIRMA_INVALIDA';

export type ResultadoVerificacionInterop = { ok: true; sucursalCodigo: string } | { ok: false; motivo: MotivoRechazoInterop };

export interface CabecerasInteropEntrada {
  sucursal?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
  signature?: string | null;
}

export interface VerificarFirmaInteropInput {
  method: string;
  /** Path exacto tal como lo firmó el emisor — ver limitación de query string en README.md. */
  path: string;
  /** Cuerpo crudo del request, "" si no hay body. */
  body: string;
  headers: CabecerasInteropEntrada;
  /**
   * Dado el código de sucursal que dice ser el emisor (ya normalizado a
   * mayúsculas), devuelve su apiKeyEntrante configurado — o
   * null/undefined si esa sucursal no existe o no tiene comunicación
   * configurada. Async porque en uso real esto consulta
   * SucursalDestino vía Prisma (Fase 4.3) — este módulo no lo hace por
   * su cuenta.
   */
  resolverSecreto: (sucursalCodigo: string) => Promise<string | null | undefined> | string | null | undefined;
  /** Por defecto, un almacén en memoria compartido por todo el proceso — ver nonce.ts. */
  nonceStore?: AlmacenNonceInterop;
  /** Instante actual en segundos desde epoch — inyectable para pruebas deterministas. Por defecto, el real. */
  ahora?: number;
  /** Ventana de tolerancia en segundos — por defecto ±5 minutos. */
  ventanaSegundos?: number;
}

function timestampValido(timestampCrudo: string | null | undefined, ahora: number, ventanaSegundos: number): number | null {
  if (!timestampCrudo || !timestampCrudo.trim()) return null;
  if (!/^-?\d+$/.test(timestampCrudo.trim())) return null;
  const timestamp = Number(timestampCrudo);
  if (!Number.isSafeInteger(timestamp)) return null;
  if (Math.abs(ahora - timestamp) > ventanaSegundos) return null;
  return timestamp;
}

/**
 * Verifica un request entrante contra el protocolo de interop (ver
 * README.md de esta carpeta para el detalle completo). Orden de
 * chequeos — deliberado, ver comentarios en línea:
 *
 *   1) sucursal conocida (resuelve el secreto)
 *   2) timestamp dentro de ventana
 *   3) firma válida (usando ESE secreto)
 *   4) nonce nuevo (recién acá, para no gastar el almacén de nonces con
 *      requests que ni siquiera traen una firma válida — evita que un
 *      atacante sin el secreto pueda "quemar" nonces ajenos a propósito)
 */
export async function verificarFirmaInterop(input: VerificarFirmaInteropInput): Promise<ResultadoVerificacionInterop> {
  const nonceStore = input.nonceStore ?? almacenNonceInteropPorDefecto;
  const ahora = input.ahora ?? Math.floor(Date.now() / 1000);
  const ventanaSegundos = input.ventanaSegundos ?? VENTANA_TIMESTAMP_SEGUNDOS_DEFAULT;

  const sucursalCruda = input.headers.sucursal?.trim();
  if (!sucursalCruda) return { ok: false, motivo: 'SUCURSAL_DESCONOCIDA' };
  const sucursalCodigo = sucursalCruda.toUpperCase();

  const secreto = await input.resolverSecreto(sucursalCodigo);
  if (!secreto) return { ok: false, motivo: 'SUCURSAL_DESCONOCIDA' };

  const timestamp = timestampValido(input.headers.timestamp, ahora, ventanaSegundos);
  if (timestamp === null) return { ok: false, motivo: 'TIMESTAMP_INVALIDO' };

  const nonce = input.headers.nonce?.trim();
  const firmaRecibida = input.headers.signature?.trim();
  if (!firmaRecibida) return { ok: false, motivo: 'FIRMA_INVALIDA' };

  // El nonce (aunque venga vacío) participa en el canonical string
  // exactamente como lo hizo del lado del emisor — validar su
  // "vacuidad" es un chequeo aparte (ver más abajo), no algo que deba
  // impedir calcular/comparar la firma primero.
  const firmaEsperada = firmarRequest(secreto, {
    method: input.method,
    path: input.path,
    timestamp: String(timestamp),
    nonce: nonce ?? '',
    body: input.body,
  });
  if (!compararTimingSafe(firmaEsperada, firmaRecibida)) return { ok: false, motivo: 'FIRMA_INVALIDA' };

  if (!nonce) return { ok: false, motivo: 'NONCE_INVALIDO' };
  const expiraEn = timestamp + ventanaSegundos;
  const esNuevo = await nonceStore.registrarSiEsNuevo(sucursalCodigo, nonce, expiraEn);
  if (!esNuevo) return { ok: false, motivo: 'NONCE_INVALIDO' };

  return { ok: true, sucursalCodigo };
}
