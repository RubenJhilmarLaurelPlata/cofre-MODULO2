'use client';

// src/components/scanner/scanner-status.tsx
// Indicador de estado del lector, compartido por Recepcion, Entrega y
// Buscador. Nunca bloquea la pantalla: es solo informativo, la entrada
// manual siempre sigue disponible sin importar el estado que muestre.
//
// Si el administrador habilito CaptureSDK (ver Configuracion → Lector
// S700), este indicador prioriza ese estado (conectado/conectando/no
// detectado, con nombre del dispositivo si se conoce — ver
// capture-js-provider.ts). Si no, muestra la heuristica de HID (ver
// hid-provider.ts sobre por que es una heuristica y no una deteccion
// real: limitacion de la WebHID API, no un descuido).
import * as React from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { hidScannerProvider } from '@/lib/scanner/hid-provider';
import { captureJsScannerProvider, estaS700Habilitado } from '@/lib/scanner/capture-js-provider';
import { cn } from '@/lib/utils';

export function ScannerStatus() {
  const [estadoHid, setEstadoHid] = React.useState(() => hidScannerProvider.getConnectionState());
  const [estadoCapture, setEstadoCapture] = React.useState(() => captureJsScannerProvider.getConnectionState());
  const [habilitado, setHabilitado] = React.useState(estaS700Habilitado());
  const [nombreDispositivo, setNombreDispositivo] = React.useState<string | null>(() => captureJsScannerProvider.getDeviceName?.() ?? null);
  const [ultimoError, setUltimoError] = React.useState<string | null>(() => captureJsScannerProvider.getUltimoError?.() ?? null);
  const [detalleAbierto, setDetalleAbierto] = React.useState(false);

  React.useEffect(() => hidScannerProvider.subscribe(setEstadoHid), []);
  React.useEffect(
    () =>
      captureJsScannerProvider.subscribe((estado) => {
        setEstadoCapture(estado);
        setHabilitado(estaS700Habilitado());
        setNombreDispositivo(captureJsScannerProvider.getDeviceName?.() ?? null);
        setUltimoError(captureJsScannerProvider.getUltimoError?.() ?? null);
      }),
    []
  );

  if (habilitado) {
    const color = estadoCapture === 'conectado' ? 'bg-emerald-500' : estadoCapture === 'conectando' ? 'bg-amber-500' : 'bg-red-500';
    const texto =
      estadoCapture === 'conectado'
        ? `S700 conectado${nombreDispositivo ? ` · ${nombreDispositivo}` : ''}`
        : estadoCapture === 'conectando'
          ? 'Conectando…'
          : 'S700 desconectado (modo HID activo)';
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setDetalleAbierto((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-ink-soft dark:hover:text-gray-300"
          title="Modo CaptureSDK (Application Mode). Si se desconecta, la entrada manual y el modo HID siguen disponibles."
        >
          {estadoCapture === 'conectando' ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
          ) : (
            <span className={cn('h-2 w-2 rounded-full', color)} />
          )}
          {texto}
          <ChevronDown className={cn('h-3 w-3 transition-transform', detalleAbierto && 'rotate-180')} />
        </button>
        {detalleAbierto && (
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-xs text-ink-soft dark:text-gray-400 shadow-popover">
            {estadoCapture !== 'conectado' && ultimoError && (
              <p className="mb-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-2 text-red-700 dark:text-red-400">
                {ultimoError}
              </p>
            )}
            <p className="mb-1 font-medium text-ink dark:text-gray-100">Cambiar de dispositivo</p>
            <p>
              El S700 solo puede estar emparejado con un equipo a la vez. Para usarlo aquí: en iPhone/iPad abre este sistema dentro de la app{' '}
              <strong>Rumba</strong>; en Android/Windows deja abierta <strong>Socket Mobile Companion</strong>. El lector se reconectará solo.
            </p>
          </div>
        )}
      </div>
    );
  }

  const conectado = estadoHid === 'conectado';
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500"
      title={conectado ? 'Se detectó un escaneo reciente (modo HID).' : 'Aún no se detectó ningún escaneo reciente. Puedes seguir escribiendo el código manualmente.'}
    >
      <span className={cn('h-2 w-2 rounded-full', conectado ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600')} />
      {conectado ? 'Lector conectado' : 'Lector no detectado'}
    </span>
  );
}
