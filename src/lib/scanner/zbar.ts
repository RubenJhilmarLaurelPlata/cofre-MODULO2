// src/lib/scanner/zbar.ts
//
// Decoder especializado para Code128, via ZBar compilado a WebAssembly
// (@undecaf/zbar-wasm, LGPL-2.1+, sin costo). Motivo (Fase 4.5):
//
// Un Code128 real, impreso, valido, en orientacion NORMAL (no de lado,
// caso confirmado con el codigo "Q03T-205" en produccion real -- iPhone
// Safari Y Android Chrome, ambos con el codigo perfectamente encuadrado
// en el visor) nunca era detectado por @zxing/library en NINGUNA de las
// dos plataformas. Esto descarta definitivamente tanto la hipotesis de la
// ronda anterior (Fase 4.4: rotacion 0°/90°, pensada para una etiqueta
// sostenida "de lado" -- ese no es este caso) como la de resolucion o
// frecuencia de reintento (ya se habian subido antes, sin efecto). El
// problema es del propio decoder de @zxing/library con Code128 real de
// camara, no de encuadre ni de orientacion.
//
// Se verifico independientemente -- ver tests/zbar-code128.test.ts, que
// generan un Code128 REAL (no una tabla de barras inventada a mano) con
// bwip-js (ya dependencia del proyecto, usada en etiquetas-pdf.ts) para
// el texto "Q03T-205" y lo decodifican con ESTA MISMA libreria (sin
// mockear), incluyendo variantes escaladas, con perspectiva/shear y
// rotadas 90° -- que ZBar SI decodifica de forma consistente.
//
// @zxing/library se mantiene como RESPALDO (nunca se elimina): si
// WebAssembly no esta disponible o el modulo de zbar-wasm no llega a
// inicializar (red, navegador muy antiguo), iniciarCode128() en
// camera-scanner.tsx cae al pipeline por capas de zxing ya existente y
// probado (Fase 4.4). QR sigue usando @zxing/library exactamente como
// antes, sin ningun cambio -- este archivo nunca se importa desde la via
// de QR.
//
// zbar.wasm se sirve como asset ESTATICO desde /public/zbar.wasm (ver
// setModuleArgs abajo) en vez de dejar que el bundler de Next.js intente
// resolver el .wasm por su cuenta -- evita cualquier problema de
// resolucion de path con webpack, y funciona sin importar que Content-Type
// le ponga Next al servirlo: si WebAssembly.instantiateStreaming() falla
// por un MIME incorrecto, la propia libreria cae a
// WebAssembly.instantiate() con un ArrayBuffer (ver su codigo fuente,
// dist/index.mjs), que no exige ningun Content-Type particular.

type ZbarModule = typeof import('@undecaf/zbar-wasm');

let scannerPromise: Promise<import('@undecaf/zbar-wasm').ZBarScanner | null> | null = null;
let zbarModulePromise: Promise<ZbarModule> | null = null;

function cargarModuloZbar(): Promise<ZbarModule> {
  if (!zbarModulePromise) {
    zbarModulePromise = import('@undecaf/zbar-wasm');
  }
  return zbarModulePromise;
}

function obtenerScannerZbar() {
  if (!scannerPromise) {
    scannerPromise = (async () => {
      if (typeof WebAssembly === 'undefined') return null;
      try {
        const { ZBarScanner, ZBarSymbolType, ZBarConfigType, setModuleArgs } = await cargarModuloZbar();
        setModuleArgs({ locateFile: () => '/zbar.wasm' });
        const scanner = await ZBarScanner.create();
        // Decoder especializado: deshabilitar todas las simbologias y
        // habilitar SOLO Code128 -- ver tests/zbar-code128.test.ts, que
        // confirma que esta configuracion exacta decodifica
        // correctamente un Code128 real.
        scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
        scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
        return scanner;
      } catch {
        // WASM bloqueado/no soportado/red -- iniciarCode128() en
        // camera-scanner.tsx cae al respaldo de zxing.
        return null;
      }
    })();
  }
  return scannerPromise;
}

/**
 * Resuelve UNA sola vez por sesion (resultado cacheado) si el decoder de
 * ZBar/WASM esta disponible en este navegador. iniciarCode128() en
 * camera-scanner.tsx la llama antes de decidir que pipeline usar durante
 * toda la vida de esa sesion de camara: true -> ZBar como unico decoder;
 * false -> respaldo de zxing por capas (Fase 4.4), sin intentar ZBar en
 * cada frame de forma inutil.
 */
export async function zbarDisponible(): Promise<boolean> {
  const scanner = await obtenerScannerZbar();
  return scanner !== null;
}

/**
 * Decodifica Code128 en una imagen ya capturada (ImageData de un canvas).
 * Devuelve el texto crudo si lo encuentra, o null si esta imagen no tiene
 * ningun Code128 (frame normal mientras se apunta la camara) O si el
 * decoder de zbar no esta disponible en este navegador -- en ambos casos
 * el llamador debe seguir intentando/usar el respaldo, nunca tratar esto
 * como un error fatal.
 */
export async function decodificarCode128ConZbar(imageData: ImageData): Promise<string | null> {
  const scanner = await obtenerScannerZbar();
  if (!scanner) return null;
  try {
    const { scanImageData, ZBarSymbolType } = await cargarModuloZbar();
    const simbolos = await scanImageData(imageData, scanner);
    const encontrado = simbolos.find((s) => s.type === ZBarSymbolType.ZBAR_CODE128);
    return encontrado ? encontrado.decode() : null;
  } catch {
    return null;
  }
}

/** Expuesto solo para pruebas: permite forzar el estado "no disponible" sin depender de WebAssembly real. */
export function _resetZbarParaPruebas() {
  scannerPromise = null;
  zbarModulePromise = null;
}
