// src/lib/interop/constantes.ts
// Fase 4.2: nombres de cabecera y valores por defecto del protocolo de
// autenticación inter-sucursales. Centralizados aquí para que firmar
// (cliente saliente) y verificar (servidor entrante) nunca puedan
// desincronizarse por escribir el nombre de una cabecera distinto en
// cada lado — ver README.md de esta carpeta para el protocolo completo.

/** Código de la sucursal EMISORA del request (ej. "LPZ", "ELA"). */
export const CABECERA_SUCURSAL = 'X-Cofre-Sucursal';
/** Segundos desde epoch (UTC), como string decimal — ver README.md. */
export const CABECERA_TIMESTAMP = 'X-Cofre-Timestamp';
/** Valor opaco único por request — ver README.md (protección contra replay). */
export const CABECERA_NONCE = 'X-Cofre-Nonce';
/** HMAC-SHA256 en hexadecimal minúscula del string canónico — ver README.md. */
export const CABECERA_FIRMA = 'X-Cofre-Signature';

/** Ventana de tolerancia por defecto para X-Cofre-Timestamp: ±5 minutos. */
export const VENTANA_TIMESTAMP_SEGUNDOS_DEFAULT = 5 * 60;
