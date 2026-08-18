'use client';

// src/lib/scanner/use-scan-queue.ts
//
// Motor unico de cola de escaneos, compartido por Recepcion, Entrega,
// Buscador y Deposito (Enviar/Bajar) — antes cada pantalla implementaba
// su propia version de este mismo patron (Recepcion y Entrega ya lo
// tenian bien resuelto por separado; Buscador no encolaba nada; Deposito
// directamente deshabilitaba el input mientras procesaba, perdiendo
// escaneos que llegaban durante ese tiempo). Ahora es una sola pieza.
//
// Reglas que resuelve, siempre:
//  - Un escaneo NUNCA se pierde ni se concatena con el siguiente: se
//    encola de inmediato (sincronico) y se procesa en orden, uno a la
//    vez, sin importar cuanto tarde la respuesta del servidor.
//  - El input NUNCA se deshabilita mientras se procesa — deshabilitarlo
//    es lo que antes hacia que un lector rapido "perdiera" escaneos en
//    silencio (el navegador ignora el teclado de un input disabled).
//  - El foco se recupera automaticamente cuando la cola se vacia
//    (exito, error, o cualquier resultado intermedio), usando
//    focusScanner() (deferred al siguiente tick, ver ese archivo).
//  - El input tambien recibe foco solo — sin que el operador lo toque —
//    apenas se monta el hook (entrar a la pantalla), no solo despues de
//    un escaneo.
import * as React from 'react';
import { focusScanner } from '@/lib/scanner/focus-scanner';

export interface UseScanQueueOptions<T> {
  /** Procesa UN item de la cola. Se espera a que termine antes de sacar el siguiente. */
  procesar: (item: T) => Promise<void> | void;
  /** Input al que se le devuelve el foco cuando la cola se vacia. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Si devuelve false, no se recupera el foco esta vez (ej: la pestaña de camara esta activa, no la de USB). Por defecto siempre se enfoca. */
  debeEnfocar?: () => boolean;
}

export interface UseScanQueueResult<T> {
  /** Encola un item de inmediato (sincronico) y dispara el drenado si no estaba corriendo ya. */
  encolar: (item: T) => void;
  /** true mientras la cola tiene algo pendiente o en curso — util para mostrar un spinner, NUNCA para deshabilitar el input. */
  procesando: boolean;
}

export function useScanQueue<T>({ procesar, inputRef, debeEnfocar }: UseScanQueueOptions<T>): UseScanQueueResult<T> {
  const colaRef = React.useRef<T[]>([]);
  const drenandoRef = React.useRef(false);
  const [procesando, setProcesando] = React.useState(false);

  // Refs para siempre llamar a la version mas reciente de estos
  // callbacks sin tener que re-crear drenar()/encolar() en cada render
  // (evita resuscribirse o perder items encolados a mitad de un cambio
  // de props).
  const procesarRef = React.useRef(procesar);
  procesarRef.current = procesar;
  const debeEnfocarRef = React.useRef(debeEnfocar);
  debeEnfocarRef.current = debeEnfocar;

  const drenar = React.useCallback(async () => {
    if (drenandoRef.current) return;
    drenandoRef.current = true;
    setProcesando(true);
    while (colaRef.current.length > 0) {
      const item = colaRef.current.shift()!;
      try {
        // eslint-disable-next-line no-await-in-loop
        await procesarRef.current(item);
      } catch (err) {
        // Cada pantalla ya envuelve su propio "procesar" en try/catch (nunca
        // deberia llegar una excepcion hasta aca) — pero si alguna vez lo
        // hiciera, sin esta red de seguridad drenandoRef.current quedaria
        // trabado en "true" para siempre: el while de arriba se corta, el
        // codigo de abajo (que lo libera) nunca se ejecuta, y CUALQUIER
        // escaneo futuro en esta pantalla quedaria encolado sin procesarse
        // nunca, en silencio, hasta recargar la pagina. Un error nunca debe
        // poder bloquear la estacion — ver especificacion.
        console.error('useScanQueue: procesar() lanzo una excepcion no capturada', err);
      }
    }
    drenandoRef.current = false;
    setProcesando(false);
    // Cubre exito, error 400/404/409/500 y excepcion de red por igual —
    // se recupera el foco pase lo que pase, salvo que el consumidor
    // indique explicitamente que no corresponde ahora (ej. camara activa).
    if (!debeEnfocarRef.current || debeEnfocarRef.current()) {
      focusScanner(inputRef);
    }
  }, [inputRef]);

  const encolar = React.useCallback(
    (item: T) => {
      colaRef.current.push(item);
      void drenar();
    },
    [drenar]
  );

  // Foco inicial al entrar a la pantalla (regla fundamental: "entrar a
  // la pagina -> cursor listo automaticamente", ver especificacion). Se
  // evalua una sola vez al montar; despues de eso el foco se recupera
  // siempre desde drenar() arriba.
  React.useEffect(() => {
    if (!debeEnfocarRef.current || debeEnfocarRef.current()) {
      focusScanner(inputRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { encolar, procesando };
}
