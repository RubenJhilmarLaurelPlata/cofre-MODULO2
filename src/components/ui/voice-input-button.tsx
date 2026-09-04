'use client';

// src/components/ui/voice-input-button.tsx
// Boton de dictado por voz reutilizable (Web Speech API). Rellena un
// campo de texto, nunca confirma operaciones (entregas, pagos) por voz
// — eso queda explícitamente fuera de su uso previsto. Si el navegador
// no soporta reconocimiento de voz, el botón simplemente no se muestra:
// el campo de texto sigue funcionando con teclado normalmente.
import * as React from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SpeechRecognitionResultLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionResultLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function obtenerConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInputButton({
  onResult,
  className,
  mostrarSiNoSoportado = false,
}: {
  onResult: (texto: string) => void;
  className?: string;
  /** Fase 2.1 (Envíos): en vez de desaparecer, muestra un ícono MicOff deshabilitado con explicación — para que quede claro que el campo sigue funcionando por teclado, en vez de dar la impresión de que falta un botón. Por defecto false (comportamiento original: no se muestra nada). */
  mostrarSiNoSoportado?: boolean;
}) {
  const [soportado, setSoportado] = React.useState(false);
  const [escuchando, setEscuchando] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => {
    setSoportado(obtenerConstructor() !== null);
  }, []);

  function alternar() {
    if (escuchando) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = obtenerConstructor();
    if (!Ctor) return;
    const reconocimiento = new Ctor();
    reconocimiento.lang = 'es-BO';
    reconocimiento.interimResults = false;
    reconocimiento.maxAlternatives = 1;
    reconocimiento.onresult = (ev) => {
      const texto = ev.results[0]?.[0]?.transcript;
      if (texto) onResult(texto);
    };
    reconocimiento.onerror = () => setEscuchando(false);
    reconocimiento.onend = () => setEscuchando(false);
    recognitionRef.current = reconocimiento;
    reconocimiento.start();
    setEscuchando(true);
  }

  React.useEffect(() => () => recognitionRef.current?.stop(), []);

  if (!soportado) {
    if (!mostrarSiNoSoportado) return null;
    return (
      <button
        type="button"
        disabled
        aria-label="Dictado por voz no disponible en este navegador"
        title="Dictado por voz no disponible en este navegador — puedes escribir normalmente"
        className={cn('flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-gray-300 dark:text-gray-700', className)}
      >
        <MicOff className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={escuchando ? 'Detener dictado' : 'Dictar por voz'}
      title={escuchando ? 'Detener dictado' : 'Dictar por voz'}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        escuchando ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:bg-gray-100 hover:text-ink dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100',
        className
      )}
    >
      {escuchando ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
