// @vitest-environment jsdom
// tests/camera-scanner.test.ts
// Fase 4.2 (Android/Chrome nunca detecta el QR real — ver
// src/lib/scanner/plataforma.ts y camera-scanner.tsx): pruebas de
// componente para la nueva regla de enrutamiento (Android -> zxing
// directo, cualquier otro navegador -> BarcodeDetector nativo si
// existe, con zxing como respaldo, exactamente como antes).
//
// @zxing/library se mockea por completo: sus internals de decodificacion
// de frames de video real (canvas, timing) no son razonables de simular
// en jsdom, y no es lo que este cambio modifica — lo que SI hay que
// probar con certeza es la DECISION de que via se usa, que nunca se
// abran dos streams a la vez, que el cleanup al desmontar se ejecute, y
// que el payload detectado llegue tal cual a onDetect (incluyendo el
// separador "codigo|qrToken" ya corregido en el commit 13cd916).
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { act } = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const decodeFromConstraintsMock = vi.fn(
  async (constraints: { video?: MediaTrackConstraints }, _video: HTMLVideoElement, callback: (result: { getText(): string } | null) => void) => {
    ultimoCallbackZxing = callback;
    ultimasConstraintsZxing = constraints.video ?? null;
  }
);
const resetZxingMock = vi.fn();
let ultimoCallbackZxing: ((result: { getText(): string } | null) => void) | null = null;
let ultimasConstraintsZxing: MediaTrackConstraints | null = null;
let ultimoTimeBetweenScansMillis: number | undefined = undefined;

// Fase 4.4 (pipeline propio por capas para code_128 — ver camera-scanner.tsx):
// decodeBitmapMock simula reader.decodeBitmap(binaryBitmap). Por defecto
// SIEMPRE lanza (ningun frame/orientacion "encuentra" nada) — cada test que
// quiere simular una deteccion exitosa cambia su mockImplementation para
// resolver solo en la rotacion que le interesa, usando las rotaciones que
// quedan registradas en rotacionesIntentadas (una por cada
// HTMLCanvasElementLuminanceSource creado, en orden).
const decodeBitmapMock = vi.fn((_rotaciones: number): { getText(): string } => {
  throw new Error('NotFoundException (fake): ningún código en este frame/orientación');
});
let rotacionesIntentadas: number[] = [];

class FakeHTMLCanvasElementLuminanceSource {
  rotaciones = 0;
  constructor(
    public canvas: unknown,
    public doAutoInvert?: boolean
  ) {}
  rotateCounterClockwise() {
    this.rotaciones += 1;
    return this;
  }
}
class FakeHybridBinarizer {
  constructor(public luminanceSource: FakeHTMLCanvasElementLuminanceSource) {}
}
class FakeBinaryBitmap {
  constructor(public binarizer: FakeHybridBinarizer) {}
}

// Fase 4.5 (ZBar/WASM como decoder primario de Code128 — ver
// src/lib/scanner/zbar.ts): se mockea por completo, igual que
// @zxing/library. Que ZBar realmente decodifica un Code128 REAL ya se
// prueba, sin mocks, en tests/zbar-code128.test.ts — aqui lo que importa
// es la ORQUESTACION del componente: que decida UNA vez por sesion cual
// pipeline usar, que arme el ImageData del frame correcto, y que nunca la
// use para qr_code.
const zbarDisponibleMock = vi.fn(async () => false); // por defecto: respaldo de zxing (Fase 4.4), igual que antes de este cambio
const decodificarCode128ConZbarMock = vi.fn(async (_imageData: unknown): Promise<string | null> => null);
vi.mock('@/lib/scanner/zbar', () => ({
  zbarDisponible: zbarDisponibleMock,
  decodificarCode128ConZbar: decodificarCode128ConZbarMock,
}));

vi.mock('@zxing/library', () => {
  class FakeBrowserMultiFormatReader {
    decodeFromConstraints = decodeFromConstraintsMock;
    reset = resetZxingMock;
    decodeBitmap(bitmap: FakeBinaryBitmap) {
      const rotaciones = bitmap.binarizer.luminanceSource.rotaciones;
      rotacionesIntentadas.push(rotaciones);
      return decodeBitmapMock(rotaciones);
    }
    constructor(_hints: unknown, timeBetweenScansMillis?: number) {
      ultimoTimeBetweenScansMillis = timeBetweenScansMillis;
    }
  }
  return {
    BrowserMultiFormatReader: FakeBrowserMultiFormatReader,
    BarcodeFormat: { CODE_128: 1, QR_CODE: 2 },
    DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS', TRY_HARDER: 'TRY_HARDER' },
    HTMLCanvasElementLuminanceSource: FakeHTMLCanvasElementLuminanceSource,
    HybridBinarizer: FakeHybridBinarizer,
    BinaryBitmap: FakeBinaryBitmap,
  };
});

// Importado DESPUES del vi.mock de arriba (vitest hoista los vi.mock,
// pero el import real de React sigue este orden en el archivo).
const { CameraScanner } = await import('@/components/scanner/camera-scanner');

const UA_ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 13; Infinix X6835) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

async function esperarAsentado() {
  // Deja que las cadenas de await encadenadas dentro de iniciar()
  // (import dinamico de zxing, getUserMedia, decodeFromConstraints/play)
  // terminen de resolver antes de aserverar — ninguna es un timer real,
  // asi que unos pocos ticks de microtarea/macrotarea alcanzan siempre.
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }
}

// iniciarZxingLineal() (pipeline propio de code_128 — Fase 4.4) usa
// requestAnimationFrame, no promesas encadenadas: jsdom SÍ implementa rAF,
// pero lo dispara por su propio timer interno (no es instantáneo como un
// setTimeout(0) encadenado) — hace falta un tiempo real de espera, no solo
// ticks de microtarea, para que el loop llegue a ejecutar al menos un
// intento de decodeBitmap().
async function esperarFrameDeCode128() {
  await new Promise((r) => setTimeout(r, 50));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  // jsdom no implementa canvas de verdad (getContext('2d') devuelve null
  // sin el paquete nativo "canvas", que a propósito no se instaló solo
  // para esto — ver iniciarZxingLineal(), todo lo que toca el canvas real
  // pasa por @zxing/library, que ya está mockeado por completo). drawImage
  // no-op alcanza: lo único que importa para estos tests es que se llame,
  // nunca el contenido real de los píxeles.
  window.HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    // Fase 4.5: el pipeline de ZBar arma un ImageData del frame antes de
    // decodificar — el contenido real de los pixeles no importa aqui
    // (@undecaf/zbar-wasm esta completamente mockeado), solo que exista.
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom nunca decodifica video real: videoWidth/videoHeight se quedan en
  // 0 para siempre, y el loop de iniciarZxingLineal() (Fase 4.4) usa
  // exactamente esa condición para saber si ya hay un frame real que
  // decodificar — sin esto, el pipeline de code_128 jamás llega a intentar
  // un solo decodeBitmap() en los tests.
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', { value: 1920, configurable: true });
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoHeight', { value: 1080, configurable: true });
  // Stream por defecto para el pipeline propio de code_128
  // (iniciarZxingLineal llama a getUserMedia directamente, nunca a través
  // de @zxing/library) — un test que necesite inspeccionar la llamada
  // define su propio mock explícito en su lugar.
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    configurable: true,
  });
  decodeFromConstraintsMock.mockClear();
  resetZxingMock.mockClear();
  decodeBitmapMock.mockClear();
  decodeBitmapMock.mockImplementation(() => {
    throw new Error('NotFoundException (fake): ningún código en este frame/orientación');
  });
  rotacionesIntentadas = [];
  zbarDisponibleMock.mockClear();
  zbarDisponibleMock.mockImplementation(async () => false);
  decodificarCode128ConZbarMock.mockClear();
  decodificarCode128ConZbarMock.mockImplementation(async () => null);
  ultimoCallbackZxing = null;
  ultimasConstraintsZxing = null;
  ultimoTimeBetweenScansMillis = undefined;
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function montar(userAgent: string, props: Partial<React.ComponentProps<typeof CameraScanner>> = {}) {
  setUserAgent(userAgent);
  const onDetect = vi.fn();
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(CameraScanner, { onDetect, formats: ['qr_code'], ...props }));
    await esperarAsentado();
  });
  return { onDetect };
}

describe('CameraScanner — enrutamiento Android vs. resto de navegadores (Fase 4.2)', () => {
  test('Android/Chrome usa zxing DIRECTO desde el arranque — nunca consulta BarcodeDetector aunque exista', async () => {
    class FakeBarcodeDetectorPresenteYSoportado {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code', 'code_128']);
      constructor(_opts: { formats: string[] }) {}
      detect = vi.fn().mockResolvedValue([]);
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetectorPresenteYSoportado;

    await montar(UA_ANDROID_CHROME);

    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1); // exactamente un stream de zxing, nunca dos
    expect(FakeBarcodeDetectorPresenteYSoportado.getSupportedFormats).not.toHaveBeenCalled();
  });

  test('iPhone/Safari (sin BarcodeDetector) sigue usando zxing exactamente igual que antes — comportamiento no cambia', async () => {
    await montar(UA_IPHONE_SAFARI);

    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
  });

  test('Desktop Chrome (no Android) con BarcodeDetector soportado usa la via nativa — BarcodeDetector no se eliminó', async () => {
    const fakeTrack = { stop: vi.fn() };
    const getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] });
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: getUserMediaMock }, configurable: true });

    class FakeBarcodeDetectorPresenteYSoportado {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code', 'code_128']);
      constructor(_opts: { formats: string[] }) {}
      detect = vi.fn().mockResolvedValue([]);
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetectorPresenteYSoportado;

    await montar(UA_DESKTOP_CHROME);

    expect(getUserMediaMock).toHaveBeenCalledTimes(1); // via nativa realmente arrancó
    expect(decodeFromConstraintsMock).not.toHaveBeenCalled(); // zxing NUNCA se usó de respaldo si el nativo sí sirve

    await act(async () => {
      root.unmount();
      await esperarAsentado();
    });
    expect(fakeTrack.stop).toHaveBeenCalledTimes(1); // cleanup del stream nativo al desmontar
  });
});

describe('CameraScanner — payload QR y cleanup en Android (zxing)', () => {
  test('el payload real detectado (código|qrToken) llega intacto a onDetect, con el token preservado (ver commit 13cd916)', async () => {
    const { onDetect } = await montar(UA_ANDROID_CHROME);
    expect(ultimoCallbackZxing).not.toBeNull();

    const payloadReal = 'env-20260904-001|c97ef562-821d-46e9-a579-75d712ea5582';
    await act(async () => {
      ultimoCallbackZxing!({ getText: () => payloadReal });
      await esperarAsentado();
    });

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect).toHaveBeenCalledWith('ENV-20260904-001|c97ef562-821d-46e9-a579-75d712ea5582');
  });

  test('un resultado nulo del lector (frame sin código) no llama a onDetect', async () => {
    const { onDetect } = await montar(UA_ANDROID_CHROME);
    await act(async () => {
      ultimoCallbackZxing!(null);
      await esperarAsentado();
    });
    expect(onDetect).not.toHaveBeenCalled();
  });

  test('desmontar detiene el lector zxing (reset) — no queda una cámara abierta en segundo plano', async () => {
    await montar(UA_ANDROID_CHROME);
    expect(resetZxingMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await esperarAsentado();
    });

    expect(resetZxingMock).toHaveBeenCalledTimes(1);
  });

  test('montar y desmontar rápido (antes de que zxing termine de arrancar) igual limpia todo, sin dejar el stream abierto', async () => {
    // decodeFromConstraints tarda "un poco" en resolver (como getUserMedia
    // real esperando el permiso) — se desmonta ANTES de que resuelva.
    let resolverDecodeFromConstraints!: () => void;
    decodeFromConstraintsMock.mockImplementationOnce(
      (_c: unknown, _v: HTMLVideoElement, callback: (r: { getText(): string } | null) => void) =>
        new Promise<void>((resolve) => {
          resolverDecodeFromConstraints = () => {
            ultimoCallbackZxing = callback;
            resolve();
          };
        })
    );

    setUserAgent(UA_ANDROID_CHROME);
    const onDetect = vi.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(CameraScanner, { onDetect, formats: ['qr_code'] }));
      await new Promise((r) => setTimeout(r, 0)); // deja arrancar iniciarZxing() pero no esperar a que resuelva
    });

    await act(async () => {
      root.unmount();
      await esperarAsentado();
    });

    // El componente ya se desmontó cuando decodeFromConstraints por fin
    // resuelve: iniciarZxing() debe notar que montadoRef.current es false
    // y llamar reset() sobre ESE mismo lector en vez de dejarlo activo.
    await act(async () => {
      resolverDecodeFromConstraints();
      await esperarAsentado();
    });

    // reset() puede llamarse mas de una vez sobre el mismo lector (una
    // vez desde el cleanup de desmontaje, y otra vez cuando
    // decodeFromConstraints por fin resuelve y nota que ya no esta
    // montado) — es idempotente y nunca dos streams reales a la vez; lo
    // que importa es que se haya llamado y que nunca se haya disparado
    // onDetect despues de desmontar.
    expect(resetZxingMock).toHaveBeenCalled();
    expect(onDetect).not.toHaveBeenCalled();
  });
});

describe('CameraScanner — Code128 (Recepción/Entrega) usa mayor resolución, sin tocar el QR (Fase 4.3)', () => {
  test('qr_code vía zxing sigue exactamente igual que antes: decodeFromConstraints, 1280x720 y el intervalo por defecto de la librería (sin cambios)', async () => {
    await montar(UA_ANDROID_CHROME, { formats: ['qr_code'] });

    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
    expect(ultimasConstraintsZxing).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });
    expect(ultimoTimeBetweenScansMillis).toBeUndefined(); // deja que @zxing/library use su propio default (500ms)
  });

  test('code_128 vía BarcodeDetector nativo (desktop) también pide 1920x1080', async () => {
    const fakeTrack = { stop: vi.fn() };
    const getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] });
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: getUserMediaMock }, configurable: true });

    class FakeBarcodeDetectorPresenteYSoportado {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code', 'code_128']);
      constructor(_opts: { formats: string[] }) {}
      detect = vi.fn().mockResolvedValue([]);
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetectorPresenteYSoportado;

    await montar(UA_DESKTOP_CHROME, { formats: ['code_128'] });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({ video: expect.objectContaining({ width: { ideal: 1920 }, height: { ideal: 1080 } }) });
  });

  test('qr_code vía BarcodeDetector nativo (desktop) sigue pidiendo 1280x720 — el QR de Envíos no se toca', async () => {
    const fakeTrack = { stop: vi.fn() };
    const getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] });
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: getUserMediaMock }, configurable: true });

    class FakeBarcodeDetectorPresenteYSoportado {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code', 'code_128']);
      constructor(_opts: { formats: string[] }) {}
      detect = vi.fn().mockResolvedValue([]);
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetectorPresenteYSoportado;

    await montar(UA_DESKTOP_CHROME, { formats: ['qr_code'] });

    expect(getUserMediaMock).toHaveBeenCalledWith({ video: expect.objectContaining({ width: { ideal: 1280 }, height: { ideal: 720 } }) });
  });

});

describe('CameraScanner — respaldo por capas de zxing cuando ZBar no está disponible (Fase 4.4, ahora fallback de la Fase 4.5)', () => {
  // Estos tests dependen de que zbarDisponibleMock resuelva false (el
  // valor por defecto en beforeEach) — así se ejercita exactamente el
  // mismo camino de respaldo que existía antes de introducir ZBar. Causa
  // raíz que motivó ESTE pipeline (ver comentario extenso al inicio de
  // camera-scanner.tsx): decodeFromConstraints() solo decodifica cada
  // frame en UNA orientación. Una etiqueta sostenida "de lado" nunca se
  // encuentra ahí. code_128 sin ZBar disponible ya NO usa
  // decodeFromConstraints en absoluto: abre la cámara por su cuenta y
  // decodifica cada frame en dos capas (0° y 90°) reutilizando el mismo
  // reader vía decodeBitmap().

  test('code_128 vía zxing NUNCA usa decodeFromConstraints — abre la cámara con getUserMedia directo, a 1920x1080', async () => {
    await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
    });

    expect(decodeFromConstraintsMock).not.toHaveBeenCalled();
    const getUserMediaMock = window.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    expect(getUserMediaMock).toHaveBeenCalledWith({ video: expect.objectContaining({ width: { ideal: 1920 }, height: { ideal: 1080 } }) });
  });

  test('un código sostenido "de lado" (solo se encuentra rotado 90°) SÍ se detecta — la capa B es justo lo que antes faltaba', async () => {
    // Simula el caso real reportado: M02S-20, Code128 válido, que una app
    // externa decodifica sin problema pero que la capa A (0°, equivalente
    // a lo que hacía decodeFromConstraints) nunca encuentra.
    decodeBitmapMock.mockImplementation((rotaciones: number) => {
      if (rotaciones === 1) return { getText: () => 'm02s-20' };
      throw new Error('NotFoundException (fake): a 0° no se encuentra, como en el caso real reportado');
    });

    const { onDetect } = await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(rotacionesIntentadas).toEqual(expect.arrayContaining([0, 1])); // probó ambas capas
    expect(onDetect).toHaveBeenCalledWith('M02S-20'); // normalizado, igual que el lector USB
  });

  test('un código legible sin rotar (0°) se acepta en la primera capa, sin necesitar la segunda', async () => {
    decodeBitmapMock.mockImplementation((rotaciones: number) => {
      if (rotaciones === 0) return { getText: () => 'M02S-20' };
      throw new Error('no debería llegar a intentarse');
    });

    const { onDetect } = await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(onDetect).toHaveBeenCalledWith('M02S-20');
  });

  test('ningún frame con código (0° y 90° fallan siempre): nunca llama a onDetect, pero sigue intentando sin romperse', async () => {
    const { onDetect } = await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(onDetect).not.toHaveBeenCalled();
    expect(decodeBitmapMock.mock.calls.length).toBeGreaterThan(0); // sí lo intentó, solo que nunca encontró nada
  });

  test('desmontar durante el pipeline de code_128 detiene el stream propio (nunca queda una cámara abierta)', async () => {
    const fakeTrack = { stop: vi.fn() };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] }) },
      configurable: true,
    });

    await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
    });

    await act(async () => {
      root.unmount();
      await esperarAsentado();
    });

    expect(fakeTrack.stop).toHaveBeenCalled();
  });
});

describe('CameraScanner — ZBar/WASM como decoder primario de Code128 (Fase 4.5)', () => {
  // Causa raíz REAL confirmada en producción (ver comentario extenso al
  // inicio de camera-scanner.tsx): un Code128 real, en orientación
  // NORMAL, perfectamente encuadrado, en iPhone/Safari Y Android/Chrome,
  // nunca era detectado por ninguna de las dos capas de zxing (Fase 4.4).
  // Que ZBar SÍ decodifica un Code128 real (incluso rotado, escalado o con
  // perspectiva) se prueba sin mocks en tests/zbar-code128.test.ts. Aquí
  // se prueba la orquestación: decidir UNA vez por sesión, nunca alternar
  // frame a frame, y no tocar QR en absoluto.

  test('cuando ZBar está disponible, decodificarCode128ConZbar se usa y decodeBitmap (zxing) NUNCA se llama', async () => {
    zbarDisponibleMock.mockImplementation(async () => true);

    await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(zbarDisponibleMock).toHaveBeenCalled();
    expect(decodificarCode128ConZbarMock).toHaveBeenCalled();
    expect(decodeBitmapMock).not.toHaveBeenCalled();
  });

  test('un texto devuelto por ZBar llega normalizado a onDetect (igual que el lector USB)', async () => {
    zbarDisponibleMock.mockImplementation(async () => true);
    decodificarCode128ConZbarMock.mockImplementation(async () => 'q03t-205');

    const { onDetect } = await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(onDetect).toHaveBeenCalledWith('Q03T-205');
  });

  test('mientras ZBar no encuentra nada (null) nunca llama a onDetect, pero sigue intentando sin romperse', async () => {
    zbarDisponibleMock.mockImplementation(async () => true);

    const { onDetect } = await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
      await esperarFrameDeCode128();
    });

    expect(onDetect).not.toHaveBeenCalled();
    expect(decodificarCode128ConZbarMock.mock.calls.length).toBeGreaterThan(0);
  });

  test('qr_code nunca consulta zbarDisponible ni decodificarCode128ConZbar — QR sigue siendo 100% zxing, sin cambios', async () => {
    zbarDisponibleMock.mockImplementation(async () => true);

    await montar(UA_ANDROID_CHROME, { formats: ['qr_code'] });
    await act(async () => {
      await esperarAsentado();
    });

    expect(zbarDisponibleMock).not.toHaveBeenCalled();
    expect(decodificarCode128ConZbarMock).not.toHaveBeenCalled();
    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
  });

  test('desmontar durante el pipeline de ZBar detiene el stream propio (nunca queda una cámara abierta)', async () => {
    zbarDisponibleMock.mockImplementation(async () => true);
    const fakeTrack = { stop: vi.fn() };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] }) },
      configurable: true,
    });

    await montar(UA_ANDROID_CHROME, { formats: ['code_128'] });
    await act(async () => {
      await esperarAsentado();
    });

    await act(async () => {
      root.unmount();
      await esperarAsentado();
    });

    expect(fakeTrack.stop).toHaveBeenCalled();
  });
});
