'use client';

// src/components/scanner/camera-scanner.tsx
//
// Escaner por camara, compartido por Recepcion, Entrega, Buscador y
// Deposito (Enviar/Bajar) — un solo componente, no una implementacion
// por pantalla. Por defecto lee Code128 (nunca QR), igual que el codigo
// real que genera el PDF de etiquetas (ver src/lib/etiquetas-pdf.ts).
// Fase 2.1 (Envios): el prop opcional `formats` permite pedir "qr_code"
// en vez del default — usado SOLO por "Envios -> Recibir envio" para
// leer el QR de un envio (ver src/app/api/envios/[id]/qr/route.ts). Los
// 4 llamadores existentes no pasan este prop, asi que su comportamiento
// no cambia en absoluto.
//
// Estrategia de deteccion:
//   - Android (ver src/lib/scanner/plataforma.ts): @zxing/library
//     DIRECTO desde el arranque. Confirmado en dispositivo real (Infinix
//     + Chrome, Fase 4.2): BarcodeDetector.getSupportedFormats() declara
//     soporte, pero detect() nunca encuentra el QR real en cuadro y
//     nunca lanza ninguna excepcion — asi que ni siquiera el watchdog de
//     iniciarNativo() (pensado para EXCEPCIONES repetidas) llega a notar
//     que deberia pasar a zxing. En vez de esperar eso, en Android se va
//     directo a la via que SI funciona.
//   - Cualquier otro navegador (desktop Chrome/Edge, y cualquiera que no
//     sea Android): BarcodeDetector nativo si existe y declara soporte
//     del formato pedido (mas rapido, no descarga ninguna libreria), con
//     @zxing/library como respaldo — necesario en iOS Safari/Chrome
//     (donde BarcodeDetector no existe) y en cualquier navegador donde
//     el nativo no soporte el formato pedido, o dejo de detectar tras
//     MAX_FALLOS_NATIVO_CONSECUTIVOS excepciones seguidas.
// Todas las vias terminan en la MISMA funcion de aceptacion
// (normalizacion, cooldown anti-repeticion, callback) — nunca hay dos
// logicas distintas de "que hacer con el texto detectado".
//
// Fase 4.4 (iPhone/Safari: un Code128 real, impreso, valido y leido sin
// problema por una app externa de escaneo en el MISMO telefono, nunca es
// detectado aqui): iOS Safari no tiene BarcodeDetector — SIEMPRE usa
// zxing, tanto para QR (que ya funciona en produccion) como para
// Code128. Ambos pasaban por el mismo BrowserMultiFormatReader.
// decodeFromConstraints(), cuyo loop interno (ver @zxing/library,
// BrowserCodeReader.createBinaryBitmap/decodeContinuously) decodifica
// cada frame en UNA sola orientacion (mas su version con colores
// invertidos — nunca una rotacion). Un QR tolera esto porque sus 3
// patrones localizadores lo hacen legible en cualquier angulo por
// diseño; un codigo LINEAL como Code128 no: sus lectores escanean filas
// horizontales de pixeles, y una etiqueta sostenida "de lado" queda con
// las barras verticales en el frame — invisible para un lector 1D en esa
// orientacion. Se agrego un pipeline propio que probaba cada frame en dos
// capas (0° y 90°) reutilizando el mismo reader de zxing.
//
// Fase 4.5 (esa correccion NO resolvio el problema real): un Code128 real
// impreso ("Q03T-205"), en orientacion NORMAL — no de lado —, perfectamente
// encuadrado en el visor, tanto en iPhone/Safari COMO en Android/Chrome,
// seguia sin ser detectado por ninguna de las dos capas de zxing. Esto
// descarta definitivamente la hipotesis de rotacion/resolucion/frecuencia:
// el problema es del propio decoder de @zxing/library con Code128 real de
// camara. Se reemplazo el decoder para code_128 por ZBar compilado a
// WebAssembly (@undecaf/zbar-wasm, ver src/lib/scanner/zbar.ts) — decoder
// especializado en codigos de barras, que soporta nativamente Code128 en
// cualquier orientacion (documentado y verificado con una imagen Code128
// real generada por bwip-js, ver tests/zbar-code128.test.ts: decodifica
// "Q03T-205" incluso escalado, con perspectiva/shear y rotado 90°, sin
// necesitar ningun intento adicional de rotacion). El pipeline de zxing
// por capas (Fase 4.4) NO se elimina: sigue siendo el RESPALDO si
// WebAssembly no esta disponible o el modulo de zbar no llega a
// inicializar (ver iniciarCode128() abajo, que decide UNA sola vez por
// sesion de camara cual de los dos usar). qr_code sigue usando
// decodeFromConstraints() de @zxing/library exactamente como antes, sin
// ningun cambio — este archivo de zbar nunca se importa desde esa via.
//
// Arranca la camara automaticamente al montarse (autoStart, por defecto
// true): el operador no debe pulsar un boton aparte para "activarla"
// despues de elegir la pestaña Camara — ver especificacion Fase 6,
// seccion 13.
import * as React from 'react';
import { Camera, CameraOff, AlertCircle, ScanLine, RotateCcw, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCameraActiva } from '@/lib/scanner/camera-provider';
import { esAndroid } from '@/lib/scanner/plataforma';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { playSound, desbloquearAudio } from '@/lib/sound';
import { vibrar } from '@/lib/haptics';
import { decodificarCode128ConZbar, zbarDisponible } from '@/lib/scanner/zbar';

type FormatoEscaneable = 'code_128' | 'qr_code';

interface CameraScannerProps {
  onDetect: (code: string) => void;
  /** Milisegundos minimos entre dos detecciones aceptadas del MISMO codigo, para no disparar el registro varias veces mientras sigue en cuadro. */
  cooldownMs?: number;
  /** Arranca la camara sola al montarse (sin exigir un click extra). Por defecto true. */
  autoStart?: boolean;
  /** Que formato(s) buscar. Por defecto solo Code128 (paquetes) — ver comentario arriba. */
  formats?: FormatoEscaneable[];
  /**
   * Fase 2.2: texto de instrucción mostrado sobre el visor mientras no se
   * detectó nada todavía. Si no se pasa, se infiere de `formats` ("código
   * QR" cuando es solo qr_code, "código de barras" en cualquier otro
   * caso) — así Recepción/Entrega/Buscador/Depósito no cambian nada, y
   * "Envíos -> Recibir envío" puede pedir un texto específico de QR sin
   * tocar este componente de nuevo.
   */
  textoInstruccion?: string;
}

type EstrategiaDeteccion = 'nativo' | 'zbar' | 'zxing' | null;

// Fase 4 (auditoria QR en produccion): sin pedir una resolucion minima,
// muchos dispositivos entregan un video de baja resolucion/foco fijo por
// defecto — mucho mas dificil de decodificar un QR real a la distancia
// normal de uso. `focusMode: 'continuous'` se ignora silenciosamente
// donde el navegador no lo soporta (nunca rompe el arranque de la
// camara), pero mejora notablemente la nitidez en los que si lo soportan
// (Chrome/Android). Mismas constraints para la via nativa y la via zxing,
// para que ambas tengan la misma calidad de imagen de entrada.
//
// Fase 4.3 (Recepcion/Entrega: el QR de Envios detecta bien, un Code128
// real no) — auditoria comparada confirmo que ambos formatos comparten
// exactamente los mismos hints/constraints hoy (ningun bug de routing),
// asi que la diferencia real es que un codigo de barras lineal necesita
// bastante mas resolucion horizontal efectiva que un QR del mismo tamaño
// fisico para que zxing/BarcodeDetector puedan resolver sus barras mas
// finas — 720p "ideal" alcanza para QR pero se queda corto para Code128
// en la distancia de uso normal. Se sube la resolucion SOLO para
// code_128 (nunca para qr_code, que ya esta confirmado funcionando en
// produccion — no se toca su configuracion en absoluto).
const VIDEO_CONSTRAINTS_QR: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
};
const VIDEO_CONSTRAINTS_BARRAS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
};

// Fase 4.3/4.5: un codigo de barras lineal es mucho mas sensible que un QR
// a que el frame exacto este bien enfocado/alineado en el instante del
// intento — probar mas seguido (150ms) da mas oportunidades de acertar un
// frame nitido mientras el operador ajusta la distancia/angulo. Usado como
// throttle explicito tanto por el pipeline de ZBar como por su respaldo de
// zxing (nunca por la via QR, que sigue usando el valor por defecto de la
// libreria).
const CODE128_INTERVALO_MS = 150;

// Fase 4: cuantos frames consecutivos puede fallar detect() del
// BarcodeDetector nativo antes de asumir que, aunque el navegador declaro
// soporte via getSupportedFormats(), el servicio de deteccion real no
// esta disponible en este dispositivo (caso documentado de Chrome/
// Android: el modulo de Play Services puede no estar descargado) — y
// pasar a zxing dinamicamente en vez de quedarse escaneando para siempre
// sin detectar nunca nada. A ~30-60fps esto son unos pocos segundos, mas
// que suficiente para no confundir "todavia no encontro el QR" (normal,
// nunca cuenta como fallo) con "esto nunca va a funcionar aqui".
const MAX_FALLOS_NATIVO_CONSECUTIVOS = 60;

export function CameraScanner({ onDetect, cooldownMs = 1800, autoStart = true, formats = ['code_128'], textoInstruccion }: CameraScannerProps) {
  const esSoloQr = formats.includes('qr_code') && !formats.includes('code_128');
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const readerRef = React.useRef<import('@zxing/library').BrowserMultiFormatReader | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const lastDetectionRef = React.useRef<{ code: string; at: number } | null>(null);
  const onDetectRef = React.useRef(onDetect);
  onDetectRef.current = onDetect;
  const montadoRef = React.useRef(true);
  // Fase 4: permite que el loop de iniciarNativo() llame a iniciarZxing()
  // como fallback dinamico sin que ambas funciones tengan que declararse
  // en un orden particular ni capturarse mutuamente en sus dependencias
  // de useCallback — mismo patron ya usado arriba para onDetectRef.
  const iniciarZxingRef = React.useRef<() => Promise<void>>(async () => {});

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
      const stream = await navigator.mediaDevices.getUserMedia({ video: esSoloQr ? VIDEO_CONSTRAINTS_QR : VIDEO_CONSTRAINTS_BARRAS });
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

      const detector = new BarcodeDetectorCtor({ formats });

      // Fase 4 (causa raiz del QR que "nunca se detecta" en produccion):
      // getSupportedFormats() puede reportar soporte de qr_code/code_128
      // aunque el servicio real de deteccion no este disponible en este
      // dispositivo concreto (modulo de Play Services no descargado, ej.
      // en algunos Android/WebView) — ahi detect() no deja de "fallar
      // silenciosamente" nunca, y sin este contador el operador se queda
      // escaneando para siempre sin que el codigo note que deberia pasar
      // a zxing. Solo cuentan las EXCEPCIONES reales de detect() — un
      // frame que resuelve con un array vacio (todavia no encontro nada)
      // es el comportamiento normal mientras se apunta la camara, nunca
      // un fallo.
      let fallosConsecutivos = 0;
      const loop = async () => {
        if (!montadoRef.current || !videoRef.current) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          fallosConsecutivos = 0;
          const primero = barcodes[0];
          if (primero?.rawValue) aceptarDeteccion(primero.rawValue);
        } catch {
          fallosConsecutivos++;
          if (fallosConsecutivos >= MAX_FALLOS_NATIVO_CONSECUTIVOS) {
            detenerNativo();
            setEstrategia(null);
            await iniciarZxingRef.current();
            return;
          }
        }
        rafIdRef.current = requestAnimationFrame(loop);
      };
      rafIdRef.current = requestAnimationFrame(loop);
      setEstrategia('nativo');
    },
    [aceptarDeteccion, formats, detenerNativo, esSoloQr]
  );

  // Fase 4.5: pipeline propio para code_128 — ver comentario extenso al
  // inicio del archivo. `reader` ya viene creado y configurado (mismos
  // hints/CODE_128/TRY_HARDER) por iniciarZxing(), y se usa SOLO si ZBar no
  // esta disponible (respaldo Fase 4.4). Esta funcion decide UNA sola vez,
  // antes de arrancar el bucle, cual decoder usar durante toda la sesion de
  // camara — nunca alterna entre ambos frame a frame.
  const iniciarCode128 = React.useCallback(
    async (reader: import('@zxing/library').BrowserMultiFormatReader) => {
      const usarZbar = await zbarDisponible();

      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS_BARRAS });
      // Mismo riesgo/mismo chequeo que iniciarNativo() — ver su comentario.
      if (!montadoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('No se pudo preparar el visor de cámara.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      // willReadFrequently: mismo hint que ya usa @zxing/library
      // internamente para su propio canvas (ver getCaptureCanvasContext()
      // en BrowserCodeReader) — le avisa a Safari que este canvas se va a
      // leer seguido (getImageData en cada frame), no solo a dibujar, para
      // que no lo trate como acelerado por GPU (mas lento/inconsistente
      // para lecturas repetidas).
      const canvas = document.createElement('canvas');
      let ctx: CanvasRenderingContext2D | null;
      try {
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      } catch {
        ctx = canvas.getContext('2d');
      }
      if (!ctx) throw new Error('No se pudo preparar el lienzo de captura.');
      const contexto = ctx;

      // Throttle explícito a CODE128_INTERVALO_MS: el RAF en sí sigue
      // corriendo a la velocidad normal del navegador (~60fps), pero cada
      // intento real es mucho más pesado que el detect() nativo de
      // iniciarNativo() (una decodificacion via WASM, o dos via zxing en
      // el respaldo). Sin este throttle se intentaría decodificar en cada
      // frame de pantalla, con un costo de CPU innecesario.
      let ultimoIntentoAt = 0;

      if (usarZbar) {
        // Decoder especializado (ZBar/WASM) — soporta Code128 en cualquier
        // orientacion de forma nativa (ver src/lib/scanner/zbar.ts y
        // tests/zbar-code128.test.ts), asi que no hace falta ningun intento
        // manual de rotacion aqui.
        let decodificando = false;
        const loopZbar = () => {
          if (!montadoRef.current || !videoRef.current) return;
          const ahora = performance.now();
          const video = videoRef.current;
          if (!decodificando && ahora - ultimoIntentoAt >= CODE128_INTERVALO_MS && video.videoWidth > 0 && video.videoHeight > 0) {
            ultimoIntentoAt = ahora;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            contexto.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
            let imageData: ImageData | null = null;
            try {
              imageData = contexto.getImageData(0, 0, canvas.width, canvas.height);
            } catch {
              imageData = null;
            }
            if (imageData) {
              decodificando = true;
              decodificarCode128ConZbar(imageData)
                .then((texto) => {
                  if (texto) aceptarDeteccion(texto);
                })
                .catch(() => {})
                .finally(() => {
                  decodificando = false;
                });
            }
          }
          rafIdRef.current = requestAnimationFrame(loopZbar);
        };
        rafIdRef.current = requestAnimationFrame(loopZbar);
        setEstrategia('zbar');
        return;
      }

      // Respaldo (Fase 4.4): ZBar no esta disponible en este navegador
      // (WebAssembly ausente o el modulo no inicializo) — mismo pipeline
      // por capas de zxing ya probado, sin ningun cambio.
      const { HTMLCanvasElementLuminanceSource, HybridBinarizer, BinaryBitmap } = await import('@zxing/library');
      const loopZxing = () => {
        if (!montadoRef.current || !videoRef.current) return;
        const ahora = performance.now();
        if (ahora - ultimoIntentoAt < CODE128_INTERVALO_MS) {
          rafIdRef.current = requestAnimationFrame(loopZxing);
          return;
        }
        ultimoIntentoAt = ahora;
        const video = videoRef.current;
        // videoWidth/videoHeight en 0 mientras el primer frame real
        // todavia no llego (comun justo despues de play()) — nada que
        // decodificar todavia, se reintenta en el siguiente frame.
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          contexto.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

          // Capa A (0 rotaciones): el frame tal cual.
          // Capa B (1 rotacion): el MISMO frame rotado 90° — cubre una
          // etiqueta sostenida "de lado".
          for (const rotaciones of [0, 1] as const) {
            try {
              const luminance = new HTMLCanvasElementLuminanceSource(canvas, true);
              for (let i = 0; i < rotaciones; i++) luminance.rotateCounterClockwise();
              const resultado = reader.decodeBitmap(new BinaryBitmap(new HybridBinarizer(luminance)));
              aceptarDeteccion(resultado.getText());
              rafIdRef.current = requestAnimationFrame(loopZxing);
              return;
            } catch {
              // Ni la capa A ni la B encontraron nada en este frame —
              // comportamiento normal mientras se apunta la cámara, nunca
              // un fallo; se reintenta en el siguiente frame.
            }
          }
        }
        rafIdRef.current = requestAnimationFrame(loopZxing);
      };
      rafIdRef.current = requestAnimationFrame(loopZxing);
      setEstrategia('zxing');
    },
    [aceptarDeteccion]
  );

  const iniciarZxing = React.useCallback(async () => {
    // Import dinamico: evita cargar la libreria (y sus dependencias del
    // navegador) durante el renderizado en el servidor.
    const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import('@zxing/library');

    const MAPA_ZXING: Record<FormatoEscaneable, number> = { code_128: BarcodeFormat.CODE_128, qr_code: BarcodeFormat.QR_CODE };
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map((f) => MAPA_ZXING[f]));
    hints.set(DecodeHintType.TRY_HARDER, true);

    // timeBetweenScansMillis (2do arg) solo lo usa el loop interno de
    // decodeFromConstraints (QR, mas abajo) — no pasarlo deja el default
    // de la libreria (500ms), sin cambios. iniciarCode128() nunca llama a
    // decodeFromConstraints; maneja su propio throttle por
    // requestAnimationFrame con CODE128_INTERVALO_MS (via ZBar, o via este
    // mismo reader como respaldo — ver su comentario).
    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    if (!videoRef.current) throw new Error('No se pudo preparar el visor de cámara.');

    if (!esSoloQr) {
      // Code128 (y cualquier otro formato lineal futuro): pipeline propio
      // — ver iniciarCode128() y el comentario extenso al inicio del
      // archivo. decodeFromConstraints() NUNCA se usa aqui.
      await iniciarCode128(reader);
      if (!montadoRef.current) reader.reset();
      return;
    }

    // QR: exactamente el mismo camino que ya esta confirmado funcionando
    // en produccion — no se toca en absoluto.
    // NOTA: en la version instalada de @zxing/library, el callback de
    // decodeFromConstraints solo recibe (result, error) — no hay un
    // tercer parametro de "controles". Para detener la camara se llama
    // reader.reset() sobre la misma instancia (guardada en readerRef).
    await reader.decodeFromConstraints({ video: VIDEO_CONSTRAINTS_QR }, videoRef.current, (result) => {
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
  }, [aceptarDeteccion, formats, esSoloQr, iniciarCode128]);
  iniciarZxingRef.current = iniciarZxing;

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

      let usoNativo = false;
      // Fase 4.2 (causa raiz confirmada en dispositivo real: Infinix +
      // Chrome — la camara abre y encuadra el QR, pero detect() nunca
      // encuentra nada, sin lanzar ninguna excepcion que el watchdog de
      // iniciarNativo() pueda contar): en Android se usa zxing como via
      // PRINCIPAL desde el arranque, sin pasar primero por
      // BarcodeDetector. BarcodeDetector NO se elimina — sigue siendo la
      // via principal para cualquier otro navegador (desktop Chrome/Edge
      // y cualquiera que no sea Android), exactamente igual que antes.
      if (esAndroid()) {
        await iniciarZxing();
      } else {
        const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          try {
            const formatosSoportados: string[] = await (
              window as unknown as { BarcodeDetector: { getSupportedFormats(): Promise<string[]> } }
            ).BarcodeDetector.getSupportedFormats();
            if (formats.every((f) => formatosSoportados.includes(f))) {
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
  }, [activa, iniciarNativo, iniciarZxing, formats]);

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
            {esSoloQr ? <QrCode className="h-8 w-8" strokeWidth={1.5} /> : <Camera className="h-8 w-8" strokeWidth={1.5} />}
            <p className="text-xs">La cámara está apagada</p>
          </div>
        )}
        {cargando && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
            {esSoloQr ? <QrCode className="h-8 w-8 animate-pulse" strokeWidth={1.5} /> : <Camera className="h-8 w-8 animate-pulse" strokeWidth={1.5} />}
            <p className="text-xs">Solicitando acceso a la cámara…</p>
          </div>
        )}
        {activa && (
          // Marco de encuadre: cuadrado y centrado para QR (así se ve
          // claramente distinto de un lector de código de barras lineal —
          // sección 8 del pedido); rectángulo horizontal para Code128,
          // igual que antes.
          esSoloQr ? (
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-brand-400" />
          ) : (
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-14 -translate-y-1/2 rounded-md border-2 border-brand-400" />
          )
        )}
      </div>

      {activa && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
          {esSoloQr ? <QrCode className="h-4 w-4 shrink-0 text-brand-500" /> : <ScanLine className="h-4 w-4 shrink-0 text-brand-500" />}
          {ultimoDetectado ? (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Código detectado</p>
              <p className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{ultimoDetectado}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {textoInstruccion ?? (esSoloQr ? 'Apunta la cámara al código QR del envío…' : 'Alinea el código de barras horizontal, a unos 10-15 cm de la cámara…')}
            </p>
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
          {estrategia === 'nativo' ? 'Detección nativa del navegador' : estrategia === 'zbar' ? 'Detección por librería (ZBar/WASM)' : 'Detección por librería (zxing)'}
        </p>
      )}
    </div>
  );
}
