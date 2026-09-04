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
  async (_constraints: unknown, _video: HTMLVideoElement, callback: (result: { getText(): string } | null) => void) => {
    ultimoCallbackZxing = callback;
  }
);
const resetZxingMock = vi.fn();
let ultimoCallbackZxing: ((result: { getText(): string } | null) => void) | null = null;

vi.mock('@zxing/library', () => {
  class FakeBrowserMultiFormatReader {
    decodeFromConstraints = decodeFromConstraintsMock;
    reset = resetZxingMock;
    constructor(_hints: unknown) {}
  }
  return {
    BrowserMultiFormatReader: FakeBrowserMultiFormatReader,
    BarcodeFormat: { CODE_128: 1, QR_CODE: 2 },
    DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS', TRY_HARDER: 'TRY_HARDER' },
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  decodeFromConstraintsMock.mockClear();
  resetZxingMock.mockClear();
  ultimoCallbackZxing = null;
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
