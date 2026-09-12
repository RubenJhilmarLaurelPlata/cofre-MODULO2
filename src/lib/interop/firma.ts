// src/lib/interop/firma.ts
// Fase 4.2: cálculo de la firma HMAC-SHA256 y su comparación timing-safe.
// Separado de canonical.ts para que quede clarísimo qué parte del
// protocolo es "armar el mensaje" y cuál es "firmarlo/compararlo" — cada
// una se puede probar por separado.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { construirCanonicalRequest, type CanonicalRequestInput } from './canonical';

/**
 * HMAC-SHA256(secreto, canonical_string), en hexadecimal minúscula.
 * Hexadecimal (no base64) es la representación elegida para TODA la firma
 * en este protocolo — ver README.md, "por qué hex y no base64".
 */
export function firmarRequest(secreto: string, input: CanonicalRequestInput): string {
  const canonical = construirCanonicalRequest(input);
  return createHmac('sha256', secreto).update(canonical, 'utf8').digest('hex');
}

/**
 * Compara dos strings de forma timing-safe (tiempo constante respecto al
 * CONTENIDO — ver más abajo la única excepción explícita: la longitud).
 * `crypto.timingSafeEqual` de Node exige que ambos buffers tengan la
 * misma longitud (lanza una excepción si no); en vez de dejar que esa
 * excepción se propague como un error inesperado, una longitud distinta
 * se trata directamente como "no coinciden" — esto SÍ revela la longitud
 * por tiempo, pero la longitud de una firma hexadecimal de un tamaño de
 * hash fijo (SHA-256 -> siempre 64 caracteres) no es información sensible
 * en la práctica, y es el patrón estándar de comparación de HMACs (ver
 * por ejemplo cómo lo resuelven las librerías de webhooks de Stripe/GitHub).
 */
export function compararTimingSafe(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
