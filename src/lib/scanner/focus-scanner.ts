// src/lib/scanner/focus-scanner.ts
import type { RefObject } from 'react';

// Punto central unico para recuperar el foco de un input de escaneo —
// usado por Recepcion, Entrega y Buscador despues de CUALQUIER resultado
// (exito, error 400/404/409/500, excepcion de red, cierre de un modal).
// Nunca depende solo de "autoFocus" (que solo aplica en el primer render).
//
// El diferido con setTimeout(...,0) es necesario, no cosmetico: si el
// input estaba "disabled" mientras se procesaba el escaneo anterior, el
// cambio de "disabled" a "false" llega via un setState que React todavia
// no aplico al DOM real en el mismo tick sincrono donde se llama esta
// funcion (React 18 agrupa esas actualizaciones) — enfocar un input que
// el DOM real todavia marca como disabled no tiene efecto. Empujar el
// foco al siguiente tick asegura que ya se aplico el re-render.
export function focusScanner(ref: RefObject<HTMLInputElement | null>) {
  setTimeout(() => ref.current?.focus(), 0);
}
