// src/lib/haptics.ts
// Vibracion corta de confirmacion para deteccion por camara (ver
// especificacion Fase 7, seccion 10) — complementa el BEEP de
// src/lib/sound.ts. navigator.vibrate() no existe en iOS/Safari (ninguna
// version, a la fecha de este archivo): ahi esta funcion simplemente no
// hace nada, sin lanzar ningun error y sin bloquear el resto del flujo de
// escaneo — el BEEP y el feedback visual siguen funcionando igual.
export function vibrar(ms = 30): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Algunos navegadores exponen navigator.vibrate pero lo bloquean
    // segun contexto (ej. pestaña no enfocada) — nunca debe romper el
    // escaneo por esto.
  }
}
