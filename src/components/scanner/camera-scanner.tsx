'use client';

// src/components/scanner/camera-scanner.tsx
//
// Escaner de codigo de barras por camara, compartido por Recepcion,
// Entrega, Buscador y Deposito (Enviar/Bajar) — un solo componente, no
// una implementacion por pantalla. Solo Code128 (nunca QR), igual que el
// codigo real que genera el PDF de etiquetas (ver src/lib/etiquetas-pdf.ts).
//
// Estrategia de deteccion (en ese orden):
//   1. BarcodeDetector nativo del navegador, si existe y declara soporte
//      para "code_128" — es la via mas rapida y liviana (no descarga
//      ninguna libreria), disponible hoy en Chrome/Edge de escritorio y
//      Android. Se consulta getSupportedFormats() en vez de asumirlo.
//   2. @zxing/library como respaldo universal — necesario en iOS
//      Safari/Chrome (donde BarcodeDetector no existe) y en cualquier
//      navegador donde el nativo no soporte Code128.
// Ambas vias terminan en la MISMA funcion de aceptacion (normalizacion,
// cooldown anti-repeticion, callback) — nunca hay dos logicas distintas
// de "que hacer con el texto detectado".
//
// Arranca la camara automaticamente al montarse (autoStart, por defecto
// true): el operador no debe pulsar un boton aparte para "activarla"
// despues de elegir la pestaña Camara — ver especificacion Fase 6,
// seccion 13.
import * as React from 'react';
import { Camera, CameraOff, AlertCircle, ScanLine, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCameraActiva } from '@/lib/scanner/camera-provider';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { playSound, desbloquearAudio } from '@/lib/sound';
import { vibrar } from '@/lib/haptics';

interface CameraScannerProps {
  onDetect: (code: string) => void;
  /** Milisegundos minimos entre dos detecciones aceptadas del MISMO codigo, para no disparar el registro varias veces mientras sigue en cuadro. */
  cooldownMs?: number;
  /** Arranca la camara sola al montarse (sin exigir un click extra). Por defecto true. */
  autoStart?: boolean;
}

type EstrategiaDeteccion = 'nativo' | 'zxing' | null;

export function CameraScanner({ onDetect, cooldownMs = 1800, autoStart = true }: CameraScannerProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const readerRef = React.useRef<import('@zxing/library').BrowserMultiFormatReader | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const lastDetectionRef = React.useRef<{ code: string; at: number } | null>(null);
  const onDetectRef = React.useRef(onDetect);
  onDetectRef.current = onDetect;
  const montadoRef = React.useRef(true);

  const [activa, setActiva] = React.useState(false);
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [estrategia, setEstrategia] = React.useState<EstrategiaDeteccion>(null);
  // Ultimo codigo detectado por la camara, mostrado en pantalla como
  // confirmacion visual de que el lector si esta leyendo — se actualiza
  // en cada deteccion, incluso durante el cooldown, para que el operador
  // vea feedback inmediato aunque el registro no se dispare de nuevo.
  const [ultimoDetectado, setUltimoDetectado] = React.useState<string | null>(null);

  // Punto UNICO de aceptacion de un texto detectado, sin importar si
  // vino del BarcodeDetector nativo o de zxing: normaliza exactamente
  // igual que el lector USB/HID (ver src/lib/codigo.ts), aplica el
  // cooldown anti-repeticion y recien ahi llama al callback. El
  // BEEP+vibracion (especificacion Fase 7, secciones 9-11) se disparan
  // AQUI, en el instante de la deteccion — no despues de que la pagina
  // que consume onDetect termine de llamar a su API, que puede tardar —
  // asi el feedback es inmediato como el de un lector fisico profesional,
  // y el mismo cooldown que evita llamar onDetect repetidamente tambien
  // evita repetir el BEEP mientras el mismo codigo sigue en cuadro.
  const aceptarDeteccion = React.useCallback(
    (textoCrudo: string) => {
      const texto = normalizarEntradaEscaneo(textoCrudo);
      if (!texto) return;
      const ahora = Date.now();
      setUltimoDetectado(texto);
      const ultima = lastDetectionRef.current;
      if (ultima && ultima.code === texto && ahora - ultima.at < cooldownMs) {
        return; // mismo codigo detectado de nuevo demasiado rapido: ignorar
      }
      lastDetectionRef.current = { code: texto, at: ahora };
      playSound('ok');
      vibrar();
      onDetectRef.current(texto);
    },
    [cooldownMs]
  );

  const detenerNativo = React.useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const detener = React.useCallback(() => {
    readerRef.current?.reset();
    readerRef.current = null;
    detenerNativo();
    setActiva(false);
    setCameraActiva(false);
    setUltimoDetectado(null);
    lastDetectionRef.current = null;
  }, [detenerNativo]);

  const iniciarNativo = React.useCallback(
    async (BarcodeDetectorCtor: new (opts: { formats: string[] }) => { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      // getUserMedia() puede tardar varios segundos en resolver (espera al
      // dialogo de permiso del sistema operativo) — si el operador cambia
      // de pestaña (vuelve a "Lector USB") ANTES de que resuelva, este
      // componente ya se desmonto para cuando llegamos aqui. Sin este
      // chequeo, el stream de camara recien obtenido queda abierto para
      // siempre (nadie vuelve a llamar stop() sobre el), consumiendo la
      // camara/bateria del dispositivo en segundo plano indefinidamente.
      if (!montadoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('No se pudo preparar el visor de cámara.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      const detector = new BarcodeDetectorCtor({ formats: ['code_128'] });

      const loop = async () => {
        if (!montadoRef.current || !videoRef.current) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          const primero = barcodes[0];
          if (primero?.rawValue) aceptarDeteccion(primero.rawValue);
        } catch {
          // Un frame fallido (ej. video todavia no tiene datos) no es un error real — se reintenta en el siguiente frame.
        }
        rafIdRef.current = requestAnimationFrame(loop);
      };
      rafIdRef.current = requestAnimationFrame(loop);
      setEstrategia('nativo');
    },
    [aceptarDeteccion]
  );

  const iniciarZxing = React.useCallback(async () => {
    // Import dinamico: evita cargar la libreria (y sus dependencias del
    // navegador) durante el renderizado en el servidor.
    const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import('@zxing/library');

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    if (!videoRef.current) throw new Error('No se pudo preparar el visor de cámara.');

    // NOTA: en la version instalada de @zxing/library, el callback de
    // decodeFromConstraints solo recibe (result, error) — no hay un
    // tercer parametro de "controles". Para detener la camara se llama
    // reader.reset() sobre la misma instancia (guardada en readerRef).
    await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current, (result) => {
      if (!result) return;
      aceptarDeteccion(result.getText());
    });
    // Mismo riesgo que en iniciarNativo (ver comentario ahi): si el
    // componente se desmonto mientras decodeFromConstraints todavia
    // esperaba el permiso/stream, hay que detener lo que zxing recien
    // abrio — reader.reset() para de verdad los tracks de MediaStream
    // (ver BrowserCodeReader.stopStreams en la libreria).
    if (!montadoRef.current) {
      reader.reset();
      return;
    }
    setEstrategia('zxing');
  }, [aceptarDeteccion]);

  const iniciandoRef = React.useRef(false);

  const iniciar = React.useCallback(async () => {
    // Evita dos arranques simultaneos (ej. el efecto de autoStart y un
    // click rapido en "Activar camara" solapandose) — eso dejaba abrir
    // dos streams de camara a la vez, ver seccion 16 de la especificacion
    // ("nunca dejar dos camaras abiertas").
    if (iniciandoRef.current || activa) return;
    iniciandoRef.current = true;
    // Un click real en "Activar camara" (o en la pestaña Camara que
    // monta este componente) es un gesto de usuario legitimo: se
    // aprovecha para desbloquear el AudioContext compartido (ver
    // src/lib/sound.ts) antes de que haga falta el primer BEEP. Si esto
    // se llama desde el autoStart del montaje (que no es un gesto), no
    // hace nada malo — simplemente no logra desbloquear nada ahi, y el
    // listener global de AudioUnlock (ver layout autenticado) cubre ese caso.
    desbloquearAudio();
    setError(null);
    setCargando(true);
    try {
      // getUserMedia solo esta disponible en un "contexto seguro"
      // (HTTPS o localhost). Acceder por una IP local en HTTP — algo
      // comun probando en la misma red — falla en iOS Safari sin dar
      // ningun error util; se detecta antes de intentarlo para dar un
      // mensaje claro en vez de caer al catch generico.
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw Object.assign(new Error('Contexto no seguro'), { name: 'InsecureContextError' });
      }

      const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      let usoNativo = false;
      if (BarcodeDetectorCtor) {
        try {
          const formatosSoportados: string[] = await (
            window as unknown as { BarcodeDetector: { getSupportedFormats(): Promise<string[]> } }
          ).BarcodeDetector.getSupportedFormats();
          if (formatosSoportados.includes('code_128')) {
            await iniciarNativo(BarcodeDetectorCtor);
            usoNativo = true;
          }
        } catch {
          // Si el nativo falla al consultarse/arrancar, se sigue de largo al respaldo zxing — nunca se deja al operador sin camara por esto.
        }
      }
      if (!usoNativo) {
        await iniciarZxing();
      }

      // Ultimo chequeo antes de marcar la camara como activa: si el
      // componente se desmonto durante cualquiera de los awaits de
      // arriba, iniciarNativo/iniciarZxing ya detuvieron el stream que
      // hubieran abierto (ver comentarios ahi) — pero sin este chequeo
      // aqui, estas dos lineas igual se ejecutarian y dejarian
      // "cameraActiva" (el flag GLOBAL que lee ScannerStatus en toda la
      // app, no solo el estado de este componente) trabado en true para
      // siempre, mostrando "Cámara conectada" aunque no haya ninguna
      // camara realmente corriendo.
      if (!montadoRef.current) return;

      setActiva(true);
      setCameraActiva(true);
    } catch (err) {
      console.error('No se pudo iniciar la cámara:', err);
      const nombre = err instanceof Error ? err.name : undefined;
      setError(
        nombre === 'NotAllowedError'
          ? 'Se denegó el permiso de cámara. En iPhone: Ajustes → Safari (o la app usada) → Cámara → Permitir. En Android/escritorio: icono de candado junto a la dirección → Permisos del sitio → Cámara → Permitir. Luego vuelve a intentar.'
          : nombre === 'InsecureContextError'
            ? 'La cámara requiere una conexión segura (HTTPS). Accede al sistema con https:// para poder usarla.'
            : nombre === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este dispositivo.'
              : nombre === 'NotReadableError'
                ? 'La cámara está siendo usada por otra aplicación. Ciérrala e intenta de nuevo.'
                : nombre === 'OverconstrainedError'
                  ? 'La cámara trasera no está disponible en este dispositivo.'
                  : 'No se pudo iniciar la cámara en este dispositivo. Puedes seguir registrando con el lector USB mientras tanto.'
      );
    } finally {
      setCargando(false);
      iniciandoRef.current = false;
    }
  }, [activa, iniciarNativo, iniciarZxing]);

  React.useEffect(() => {
    montadoRef.current = true;
    if (autoStart) void iniciar();
    return () => {
      montadoRef.current = false;
      readerRef.current?.reset();
      detenerNativo();
      setCameraActiva(false);
    };
    // Solo al montar/desmontar — reiniciar la camara si "iniciar" cambia de identidad rompería el flujo (cerraría y volvería a abrir el stream sin motivo real).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900">
        <video ref={videoRef} className="h-full w-full object-cover" muted autoPlay playsInline />
        {!activa && !cargando && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
            <Camera className="h-8 w-8" strokeWidth={1.5} />
            <p className="text-xs">La cámara está apagada</p>
          </div>
        )}
        {cargando && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
            <Camera className="h-8 w-8 animate-pulse" strokeWidth={1.5} />
            <p className="text-xs">Solicitando acceso a la cámara…</p>
          </div>
        )}
        {activa && (
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-14 -translate-y-1/2 rounded-md border-2 border-brand-400" />
        )}
      </div>

      {activa && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
          <ScanLine className="h-4 w-4 shrink-0 text-brand-500" />
          {ultimoDetectado ? (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Código detectado</p>
              <p className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{ultimoDetectado}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">Apunta la cámara al código de barras…</p>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="button"
        variant={activa ? 'secondary' : 'primary'}
        className="w-full"
        loading={cargando}
        onClick={activa ? detener : iniciar}
      >
        {activa ? (
          <>
            <CameraOff className="h-4 w-4" /> Apagar cámara
          </>
        ) : error ? (
          <>
            <RotateCcw className="h-4 w-4" /> Reintentar
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" /> Activar cámara
          </>
        )}
      </Button>
      {estrategia && activa && (
        <p className="text-center text-[10px] text-gray-300 dark:text-gray-600">
          {estrategia === 'nativo' ? 'Detección nativa del navegador' : 'Detección por librería (zxing)'}
        </p>
      )}
    </div>
  );
}
