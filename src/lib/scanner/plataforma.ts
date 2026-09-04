// src/lib/scanner/plataforma.ts
// Deteccion de plataforma para camera-scanner.tsx (Fase 4.2 — bug real de
// produccion: en Android/Chrome, BarcodeDetector puede declarar soporte
// de QR/Code128 via getSupportedFormats() sin que el servicio real de
// deteccion este disponible en el dispositivo concreto. Confirmado en
// pruebas reales: Infinix + Chrome, la camara abre y encuadra el QR
// correctamente, pero detect() nunca encuentra nada — y nunca lanza
// ninguna excepcion, asi que el watchdog de iniciarNativo() (pensado
// para EXCEPCIONES repetidas, no para "siempre resuelve vacio en
// silencio") tampoco activa el respaldo a zxing. Por eso en Android se
// usa @zxing/library (la misma libreria que ya cubre iOS Safari, cero
// dependencias nuevas) como via PRINCIPAL desde el arranque, sin
// esperar a que el nativo demuestre que no funciona.
//
// navigator.userAgentData (Client Hints, disponible en Chromium) es mas
// confiable que el string de user-agent cuando existe, asi que se
// consulta primero. El string de user-agent como respaldo NO es fragil
// para este caso puntual: a diferencia de "detectar iOS" (donde iPadOS
// puede identificarse como escritorio, y donde Safari tiene variantes
// dificiles de distinguir), ningun navegador Android real omite el
// token "Android" de su user-agent — es la señal de plataforma mas
// standard y estable que existe del lado del cliente para este caso.
export interface NavegadorConPlataforma {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * `nav` es opcional y solo existe para poder probar esta funcion con un
 * navegador falso en los tests (sin necesidad de un entorno jsdom) — en
 * uso real (camera-scanner.tsx) siempre se llama sin argumentos, y toma
 * el `navigator` real del navegador.
 */
export function esAndroid(nav?: NavegadorConPlataforma): boolean {
  const navegador: NavegadorConPlataforma | undefined =
    nav ?? (typeof navigator !== 'undefined' ? (navigator as NavegadorConPlataforma) : undefined);
  if (!navegador) return false;
  const plataforma = navegador.userAgentData?.platform;
  if (plataforma) return plataforma === 'Android';
  return /Android/i.test(navegador.userAgent ?? '');
}
