// src/lib/sound.ts
// Sonidos diferenciados por tipo de evento, para que el operador distinga
// que paso sin mirar la pantalla. Solo se ejecuta en el navegador.

export type SoundType = 'ok' | 'deposito' | 'duplicado' | 'error';

// Interruptor global (Modulo 7 — Preferencias): se inicializa una sola
// vez desde Company.sonidosActivos al cargar el area autenticada
// (ver SoundPreferenceSync en el layout), y playSound lo respeta en
// cada llamada, sin que cada pantalla tenga que revisarlo por su cuenta.
let sonidosActivos = true;

export function setSonidosActivos(activos: boolean): void {
  sonidosActivos = activos;
}

const PATRONES: Record<SoundType, Array<[frecuencia: number, duracion: number]>> = {
  ok: [[880, 0.12]],
  deposito: [
    [660, 0.09],
    [880, 0.09],
  ],
  duplicado: [
    [520, 0.09],
    [380, 0.16],
  ],
  error: [[220, 0.22]],
};

// Un unico AudioContext reutilizado entre llamadas (module-level, creado
// perezosamente). Antes se creaba uno nuevo en cada playSound(): en iOS
// Safari, un AudioContext creado fuera de una cadena sincrona de gesto
// del usuario (ej. despues de un fetch/await, como pasa aqui tras
// confirmar un escaneo) puede quedar en estado "suspended" y nunca
// sonar — sin lanzar ninguna excepcion, asi que el try/catch no lo
// detectaba. Reutilizar el mismo contexto y llamar resume() antes de
// programar el sonido corrige esto sin cambiar el resto del comportamiento.
let audioCtx: AudioContext | null = null;

function obtenerAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const AudioCtxClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;
  audioCtx = new AudioCtxClass();
  return audioCtx;
}

function reproducir(ctx: AudioContext, tipo: SoundType): void {
  const pasos = PATRONES[tipo];
  let t = ctx.currentTime;
  pasos.forEach(([freq, dur]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.value = 0.18;
    osc.start(t);
    osc.stop(t + dur);
    t += dur + 0.02;
  });
}

export function playSound(tipo: SoundType = 'ok'): void {
  if (typeof window === 'undefined' || !sonidosActivos) return;
  try {
    const ctx = obtenerAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => reproducir(ctx, tipo)).catch(() => {});
      return;
    }
    reproducir(ctx, tipo);
  } catch {
    // Si el navegador bloquea audio (falta interaccion del usuario, etc.)
    // simplemente no sonamos; el feedback visual sigue funcionando.
  }
}

// Desbloquea/"prepara" el AudioContext compartido durante la PRIMERA
// interaccion legitima del usuario (click en una pestaña, tecla del
// lector, tap en la pantalla) — ver especificacion Fase 7, seccion 11.
// Safari/iOS crea el AudioContext en estado "suspended" hasta que se
// llama resume() dentro de la cadena sincronica de un gesto real; sin
// esto, el primer BEEP disparado por una deteccion de camara (que NO es
// un gesto de usuario, es un callback async) puede quedar mudo para
// siempre. Se llama una sola vez por sesion (ver AudioUnlock, montado
// globalmente en el layout autenticado) — nunca agrega un boton ni una
// interaccion extra para el operador.
export function desbloquearAudio(): void {
  if (typeof window === 'undefined' || !sonidosActivos) return;
  try {
    const ctx = obtenerAudioCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  } catch {
    // No hay AudioContext disponible en este navegador — nada que desbloquear.
  }
}
