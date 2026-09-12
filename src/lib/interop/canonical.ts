// src/lib/interop/canonical.ts
// Fase 4.2: construcción DETERMINISTA del string canónico que se firma
// (lado emisor) y se reconstruye para verificar (lado receptor) — ver
// README.md de esta carpeta para el formato completo documentado. Este
// archivo no sabe nada de HTTP real (Next.js/fetch): recibe strings ya
// extraídos, para poder probarse sin ningún servidor real.
import { createHash } from 'node:crypto';

export interface CanonicalRequestInput {
  /** Método HTTP, ej. "POST" — se normaliza a mayúsculas internamente. */
  method: string;
  /** Path exacto del request, ej. "/api/interop/envios/ENV-20260904-001". Sin query string (ver README.md, limitación conocida de esta fase). */
  path: string;
  /** Segundos desde epoch (UTC), como string decimal — el mismo valor que viaja en X-Cofre-Timestamp. */
  timestamp: string;
  /** Valor del nonce — el mismo que viaja en X-Cofre-Nonce. */
  nonce: string;
  /** Cuerpo crudo del request tal cual se envía por la red (string vacío "" si no hay body, ej. un GET). */
  body: string;
}

/** SHA-256 del body en hexadecimal minúscula, codificando el string explícitamente en UTF-8 (soporta Unicode sin ambigüedad — ver tests). */
export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Arma el string canónico:
 *
 *   METHOD + "\n" +
 *   PATH + "\n" +
 *   TIMESTAMP + "\n" +
 *   NONCE + "\n" +
 *   SHA256(BODY)
 *
 * Determinista: la misma entrada produce siempre el mismo string, y
 * cambiar cualquiera de los cinco componentes cambia el resultado (ver
 * tests/interop-auth.test.ts, "canonicalización determinista").
 */
export function construirCanonicalRequest(input: CanonicalRequestInput): string {
  const metodo = input.method.trim().toUpperCase();
  const bodyHash = sha256Hex(input.body);
  return [metodo, input.path, input.timestamp, input.nonce, bodyHash].join('\n');
}
