'use client';

// src/components/layout/audio-unlock.tsx
// Componente invisible, montado una sola vez en el area autenticada (ver
// (app)/layout.tsx): escucha la PRIMERA interaccion real del usuario en
// toda la sesion (click, tap, tecla — cualquiera de las tres cuenta como
// gesto legitimo para el navegador) y usa ese instante para desbloquear
// el AudioContext compartido (ver src/lib/sound.ts:desbloquearAudio).
// Necesario para que el BEEP de una deteccion de camara (que llega por un
// callback async, no por un gesto de usuario) realmente suene en
// Safari/iOS — sin esto, el primer intento de sonido puede quedar mudo
// para siempre. No agrega ningun boton ni paso extra: el operador ya va a
// tocar la pantalla o el teclado para llegar a cualquier pantalla de
// escaneo.
import * as React from 'react';
import { desbloquearAudio } from '@/lib/sound';

export function AudioUnlock() {
  React.useEffect(() => {
    let hecho = false;
    const desbloquear = () => {
      if (hecho) return;
      hecho = true;
      desbloquearAudio();
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
      window.removeEventListener('touchend', desbloquear);
    };
    window.addEventListener('pointerdown', desbloquear, { once: true });
    window.addEventListener('keydown', desbloquear, { once: true });
    window.addEventListener('touchend', desbloquear, { once: true });
    return () => {
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
      window.removeEventListener('touchend', desbloquear);
    };
  }, []);

  return null;
}
