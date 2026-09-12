// src/lib/interop/adaptador-next.ts
// Fase 4.3: único punto de esta carpeta que conoce Next.js — traduce un
// NextRequest real a la entrada plana que ya espera verificarFirmaInterop()
// (verificar.ts, que sigue sin saber nada de Next). Cualquier futuro
// endpoint /api/interop/* llama a esta función en vez de repetir su
// propia extracción de headers/body/pathname.
import type { NextRequest } from 'next/server';
import { CABECERA_SUCURSAL, CABECERA_TIMESTAMP, CABECERA_NONCE, CABECERA_FIRMA } from './constantes';
import { verificarFirmaInterop, type VerificarFirmaInteropInput, type ResultadoVerificacionInterop } from './verificar';

export interface VerificarRequestInteropNextOpts {
  resolverSecreto: VerificarFirmaInteropInput['resolverSecreto'];
  nonceStore?: VerificarFirmaInteropInput['nonceStore'];
  /** Inyectables para pruebas deterministas — ver verificar.ts. */
  ahora?: number;
  ventanaSegundos?: number;
}

/**
 * `req.nextUrl.pathname` nunca incluye query string (a diferencia de
 * `req.url` completo) — es exactamente el PATH que exige el protocolo
 * (ver README.md, "MUY IMPORTANTE: no incluir query string"). `req.text()`
 * consume el body crudo tal cual llegó (string vacío para un GET sin
 * cuerpo) — se lee UNA sola vez aquí; si el endpoint necesita el JSON
 * parseado después de autenticar, debe volver a parsear ese mismo string
 * (`JSON.parse(body)`), nunca volver a leer `req.json()`/`req.text()`
 * sobre el mismo request (el stream del body ya se consumió).
 */
export async function verificarRequestInteropNext(req: NextRequest, opts: VerificarRequestInteropNextOpts): Promise<{ resultado: ResultadoVerificacionInterop; body: string }> {
  const body = await req.text();
  const resultado = await verificarFirmaInterop({
    method: req.method,
    path: req.nextUrl.pathname,
    body,
    headers: {
      sucursal: req.headers.get(CABECERA_SUCURSAL),
      timestamp: req.headers.get(CABECERA_TIMESTAMP),
      nonce: req.headers.get(CABECERA_NONCE),
      signature: req.headers.get(CABECERA_FIRMA),
    },
    resolverSecreto: opts.resolverSecreto,
    nonceStore: opts.nonceStore,
    ahora: opts.ahora,
    ventanaSegundos: opts.ventanaSegundos,
  });
  return { resultado, body };
}
