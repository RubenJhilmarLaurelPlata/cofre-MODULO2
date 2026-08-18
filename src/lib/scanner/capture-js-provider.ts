'use client';

// src/lib/scanner/capture-js-provider.ts
//
// Integracion real (no simulada) con Socket Mobile Capture JS — el modo
// "Application Mode" del S700, alternativo a HID (ver hid-provider.ts).
//
// Investigado contra la documentacion oficial de Socket Mobile
// (docs.socketmobile.dev/capturejs): la libreria se carga como <script
// type="module"> desde su CDN, se inicializa con tres credenciales
// (appId/developerId/appKey, gratuitas, registradas por dominio en
// socketmobile.com) y expone eventos DeviceArrival/DeviceRemoval/
// DecodedData a traves de un objeto global `SocketMobile`.
//
// LIMITACION REAL DE PLATAFORMA (confirmada en la documentacion, no es un
// descuido de esta implementacion):
//   - Windows / Android: requiere "Socket Mobile Companion" corriendo en
//     el equipo (app gratuita de Socket Mobile, no de Cofre Express).
//   - iOS (iPhone/iPad): Capture JS NO funciona dentro de Safari. Solo
//     funciona si esta pagina se abre dentro de la app "Rumba" de Socket
//     Mobile (su propio contenedor web, no una app que debamos construir
//     nosotros). En Safari, el S700 debe seguir usandose en modo HID.
//   - Mac: no existe hoy una via de CaptureSDK para el S700 especifico
//     desde un navegador estandar. HID es el unico camino real.
//
// Por eso este proveedor SOLO se activa si el administrador configuro un
// AppKey en Configuracion (Company.s700Habilitado) — nunca reemplaza a
// HID, que sigue siendo el modo universal por defecto sin instalar nada
// (ver src/lib/scanner/hid-provider.ts).
//
// NOTA DE HONESTIDAD: esta implementacion se escribio a partir de la
// documentacion publica de Socket Mobile (nombres de eventos y forma de
// las credenciales confirmados), pero no pudo probarse contra un S700
// fisico ni un AppKey real en este entorno de desarrollo. Antes de
// depender de esto en produccion, validar una vez con hardware real y
// re-confirmar la version vigente del script del CDN.

import type { ScannerProvider, ScannerConnectionState } from '@/lib/scanner/types';

export interface S700Credenciales {
  appId: string;
  developerId: string;
  appKey: string;
}

// Version documentada al momento de esta integracion (ver
// docs.socketmobile.dev/capturejs/en/latest/gettingStarted.html).
// Revisar si sigue vigente antes de desplegar a producción.
const CAPTURE_JS_SCRIPT_URL = 'https://socketimagescdn.azureedge.net/cdn/scripts/captureJs-2.0.2.228.js';

// Forma minima del objeto global que expone captureJs-*.js. Los nombres
// de evento (DeviceArrival, DeviceRemoval, DecodedData) y la forma de
// "appInfo" estan confirmados por la documentacion oficial; el resto de
// la superficie del SDK (metodos de open/close exactos) puede variar
// entre versiones, por eso todo el acceso esta protegido con try/catch.
interface CaptureEventValue {
  guid?: string;
  name?: string;
  data?: number[] | Uint8Array;
}
interface CaptureEvent {
  id: string;
  value: CaptureEventValue;
}
interface SocketMobileGlobal {
  CaptureEventIds: Record<string, string>;
  Capture: new () => {
    open(appInfo: S700Credenciales): Promise<unknown>;
    close?(): Promise<unknown>;
    onEvent?: ((event: CaptureEvent) => void) | null;
  };
}

declare global {
  interface Window {
    SocketMobile?: SocketMobileGlobal;
  }
}

let scriptCargando: Promise<void> | null = null;

function cargarScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No hay window (SSR).'));
  if (window.SocketMobile) return Promise.resolve();
  if (scriptCargando) return scriptCargando;

  scriptCargando = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = CAPTURE_JS_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar el script de Socket Mobile Capture JS.'));
    document.head.appendChild(script);
  });
  return scriptCargando;
}

function bytesATexto(data: number[] | Uint8Array | undefined): string {
  if (!data) return '';
  return Array.from(data)
    .map((b) => String.fromCharCode(b))
    .join('');
}

type Listener = (state: ScannerConnectionState) => void;

let estadoActual: ScannerConnectionState = 'no-detectado';
let nombreDispositivo: string | null = null;
let habilitado = false;
let ultimoError: string | null = null;
const listeners = new Set<Listener>();
const listenersEscaneo = new Set<(code: string) => void>();
let captureInstance: InstanceType<SocketMobileGlobal['Capture']> | null = null;

// Cuanto esperar por un DeviceArrival real antes de dejar de mostrar
// "Conectando…" indefinidamente. Sin este timeout, si open() resuelve
// pero el lector nunca llega a emparejarse (credenciales invalidas,
// Companion/Rumba no esta corriendo, etc.), el estado se quedaba
// colgado en 'conectando' para siempre.
const TIMEOUT_CONEXION_MS = 15_000;
let timeoutConexion: ReturnType<typeof setTimeout> | null = null;

function limpiarTimeoutConexion() {
  if (timeoutConexion) {
    clearTimeout(timeoutConexion);
    timeoutConexion = null;
  }
}

function fijarEstado(nuevo: ScannerConnectionState, error?: string | null) {
  estadoActual = nuevo;
  if (error !== undefined) ultimoError = error;
  listeners.forEach((l) => l(nuevo));
}

/**
 * Inicializa (o reinicializa) la conexion con el S700 en Application
 * Mode. Se llama una vez, con las credenciales configuradas por el
 * administrador (ver Configuracion → Lector S700). Si `credenciales` es
 * null, apaga la integracion (vuelve a depender solo de HID).
 */
export async function configurarS700(credenciales: S700Credenciales | null): Promise<void> {
  limpiarTimeoutConexion();

  if (!credenciales) {
    habilitado = false;
    try {
      await captureInstance?.close?.();
    } catch {
      // No hay nada mas que hacer si el cierre falla — HID sigue funcionando igual.
    }
    captureInstance = null;
    nombreDispositivo = null;
    fijarEstado('no-detectado', null);
    return;
  }

  habilitado = true;
  fijarEstado('conectando', null);
  try {
    await cargarScript();
    const SocketMobileNS = window.SocketMobile;
    if (!SocketMobileNS) {
      // El script cargo pero no expuso el global esperado: SDK
      // incompatible con esta version, o entorno no soportado (ej. Mac
      // fuera de Rumba/Companion). No fingimos "conectado".
      fijarEstado('no-detectado', 'El script de Socket Mobile cargó pero no expuso la interfaz esperada en este navegador/plataforma.');
      return;
    }

    captureInstance = new SocketMobileNS.Capture();
    captureInstance.onEvent = (event: CaptureEvent) => {
      if (event.id === SocketMobileNS.CaptureEventIds.DeviceArrival) {
        limpiarTimeoutConexion();
        nombreDispositivo = event.value.name ?? event.value.guid ?? 'Lector S700';
        fijarEstado('conectado', null);
      } else if (event.id === SocketMobileNS.CaptureEventIds.DeviceRemoval) {
        nombreDispositivo = null;
        fijarEstado('no-detectado', null);
      } else if (event.id === SocketMobileNS.CaptureEventIds.DecodedData) {
        const codigo = bytesATexto(event.value.data);
        if (codigo) listenersEscaneo.forEach((l) => l(codigo));
      }
    };

    await captureInstance.open(credenciales);
    // Si "open" resuelve sin un DeviceArrival previo, el lector todavia
    // no esta emparejado en Application Mode — el estado se queda
    // "conectando" hasta que llegue el evento real (nunca se asume
    // conectado), pero con un limite de tiempo: si nunca llega, el
    // timeout de abajo lo pasa a "no-detectado" con un error explicito
    // en vez de dejarlo colgado para siempre.
    timeoutConexion = setTimeout(() => {
      if (estadoActual === 'conectando') {
        fijarEstado(
          'no-detectado',
          'No se recibió confirmación del lector (evento DeviceArrival) en 15 segundos. Verifica que Socket Mobile Companion/Rumba esté abierto y el S700 emparejado.'
        );
      }
    }, TIMEOUT_CONEXION_MS);
  } catch (err) {
    console.error('No se pudo inicializar Socket Mobile Capture JS:', err);
    const mensaje = err instanceof Error ? err.message : 'Error desconocido al inicializar Socket Mobile Capture JS.';
    fijarEstado('no-detectado', mensaje);
  }
}

/** Se llama con cada codigo decodificado por el S700 en Application Mode. */
export function onEscaneoCaptureJs(callback: (code: string) => void): () => void {
  listenersEscaneo.add(callback);
  return () => listenersEscaneo.delete(callback);
}

/** Si el administrador configuro y habilito CaptureSDK (Configuracion → Lector S700). No implica que este conectado, solo que este modo esta activo. */
export function estaS700Habilitado(): boolean {
  return habilitado;
}

export const captureJsScannerProvider: ScannerProvider = {
  id: 'socket-capture-sdk',
  label: 'Socket Mobile CaptureSDK (Application Mode)',
  getConnectionState: () => estadoActual,
  getDeviceName: () => nombreDispositivo,
  getUltimoError: () => ultimoError,
  subscribe(onChange) {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  },
};
