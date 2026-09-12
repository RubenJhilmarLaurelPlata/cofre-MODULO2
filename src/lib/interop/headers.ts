// src/lib/interop/headers.ts
// Fase 4.2: construcción de las 4 cabeceras que un request SALIENTE debe
// llevar. No hace ningún fetch — solo calcula qué cabeceras poner; la
// llamada HTTP real es responsabilidad de la Fase 4.3 (esta fase no la
// implementa, ver README.md).
import { randomUUID } from 'node:crypto';
import { CABECERA_SUCURSAL, CABECERA_TIMESTAMP, CABECERA_NONCE, CABECERA_FIRMA } from './constantes';
import { firmarRequest } from './firma';

export interface CrearHeadersInteropInput {
  /** Código de ESTA instalación (la que firma/emite), ej. "LPZ" — viaja en X-Cofre-Sucursal. */
  sucursalCodigo: string;
  /** apiKeySaliente configurado para el destino (ver SucursalDestino, Fase 4.1). Nunca viaja en ninguna cabecera. */
  secreto: string;
  method: string;
  path: string;
  body: string;
  /** Inyectable para pruebas deterministas — por defecto, el instante real. */
  timestamp?: number;
  /** Inyectable para pruebas deterministas — por defecto, un UUID nuevo. */
  nonce?: string;
}

export type HeadersInterop = {
  [CABECERA_SUCURSAL]: string;
  [CABECERA_TIMESTAMP]: string;
  [CABECERA_NONCE]: string;
  [CABECERA_FIRMA]: string;
};

export function crearHeadersInterop(input: CrearHeadersInteropInput): HeadersInterop {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomUUID();
  const firma = firmarRequest(input.secreto, { method: input.method, path: input.path, timestamp, nonce, body: input.body });

  return {
    [CABECERA_SUCURSAL]: input.sucursalCodigo,
    [CABECERA_TIMESTAMP]: timestamp,
    [CABECERA_NONCE]: nonce,
    [CABECERA_FIRMA]: firma,
  };
}
