'use client';

// src/lib/scanner/hid-provider.ts
//
// LIMITACION REAL (documentada a proposito, no es un descuido): un lector
// de codigos de barras en modo HID/keyboard-wedge — como el Socket
// Mobile S700 en su configuracion por defecto — es indistinguible para
// el navegador de un teclado comun. La especificacion WebHID excluye
// explicitamente los dispositivos de "pagina de uso" teclado/mouse por
// seguridad, asi que ninguna API web puede confirmar "hay un lector HID
// conectado" de forma confiable. Por eso este provider usa una heuristica
// honesta: si hubo un escaneo valido reciente (ventana corta), se marca
// "conectado"; si no, "no detectado" — nunca finge saberlo con certeza.
//
// Es un modulo (no un componente) para que Recepcion y Entrega compartan
// el mismo estado sin duplicar logica ni pasar props entre pantallas.

import type { ScannerProvider, ScannerConnectionState } from '@/lib/scanner/types';

const VENTANA_ACTIVO_MS = 20_000;

let ultimoEscaneoAt = 0;
const listeners = new Set<(state: ScannerConnectionState) => void>();

function estadoActual(): ScannerConnectionState {
  return Date.now() - ultimoEscaneoAt < VENTANA_ACTIVO_MS ? 'conectado' : 'no-detectado';
}

function notificar() {
  const estado = estadoActual();
  listeners.forEach((l) => l(estado));
}

/** Recepcion y Entrega llaman esto en cada escaneo (HID o camara) exitoso. */
export function reportarEscaneoExitoso() {
  ultimoEscaneoAt = Date.now();
  notificar();
  // Vuelve a evaluarse cuando termina la ventana, para pasar a "no detectado" sin necesitar otro escaneo.
  setTimeout(notificar, VENTANA_ACTIVO_MS + 50);
}

export const hidScannerProvider: ScannerProvider = {
  id: 'hid',
  label: 'Lector USB/Bluetooth (HID)',
  getConnectionState: estadoActual,
  subscribe(onChange) {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  },
};
