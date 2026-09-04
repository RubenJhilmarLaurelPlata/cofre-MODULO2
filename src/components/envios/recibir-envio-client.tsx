'use client';

// src/components/envios/recibir-envio-client.tsx
// "Envíos → Recibir envío" (Fase 2.1): escanear el QR de un envío
// cerrado (el QR codifica su código, ej. "ENV-20260904-003" — ver
// src/app/api/envios/[id]/qr/route.ts) y confirmar de un vistazo, sin
// escanear paquete por paquete. Hoy origen/destino se resuelven contra
// esta misma base de datos (no existe todavía comunicación real entre
// servidores — ver src/lib/envios.ts:recibirEnvio()).
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, QrCode, Container, Package, ArrowRight, CheckCircle2, XCircle, Ban, PackageCheck, Camera as CameraIcon, Keyboard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { TecladoVirtual } from '@/components/scanner/teclado-virtual';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { playSound } from '@/lib/sound';
import { cn } from '@/lib/utils';

interface EnvioParaRecibirDTO {
  id: string;
  codigo: string;
  estado: string;
  destino: { nombre: string; ciudad: string | null };
  origen: { codigo: string | null; nombre: string | null };
  cantidadPaquetes: number;
}

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador (todavía no fue cerrado)',
  CERRADO: 'En tránsito',
  RECIBIDO: 'Recibido',
  CANCELADO: 'Cancelado',
};

export function RecibirEnvioClient() {
  const [valor, setValor] = React.useState('');
  const [envio, setEnvio] = React.useState<EnvioParaRecibirDTO | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [recibiendo, setRecibiendo] = React.useState(false);
  const [recibido, setRecibido] = React.useState<EnvioParaRecibirDTO | null>(null);
  // Dos caminos claros (sección 9 del pedido): "manual" es el default —
  // funciona en cualquier dispositivo sin pedir permiso de cámara —
  // "camara" es opcional, para leer el QR directamente. La cámara nunca
  // se activa sola: solo al elegir explícitamente ese modo.
  const [modo, setModo] = React.useState<'manual' | 'camara'>('manual');
  // Teclado en pantalla (sección 10 del pedido): NO es un input.focus()
  // disfrazado — es el mismo TecladoVirtual compartido que ya usan
  // Buscador/Depósito para cuando un lector Bluetooth oculta el teclado
  // real del dispositivo.
  const [mostrarTeclado, setMostrarTeclado] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  async function procesarBuscar(codigo: string) {
    setError(null);
    setEnvio(null);
    setBuscando(true);
    try {
      const res = await fetch(`/api/envios/buscar?codigo=${encodeURIComponent(codigo)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se encontró ese envío.');
        playSound('error');
        return;
      }
      setEnvio(data);
      playSound('ok');
    } finally {
      setBuscando(false);
    }
  }

  const { encolar } = useScanQueue<string>({
    procesar: procesarBuscar,
    inputRef,
    debeEnfocar: () => !envio && !recibido,
  });

  function buscar(codigoCrudo: string) {
    const codigo = normalizarEntradaEscaneo(codigoCrudo);
    setValor('');
    if (!codigo) return;
    encolar(codigo);
  }

  async function confirmarRecepcion() {
    if (!envio) return;
    setRecibiendo(true);
    setError(null);
    try {
      const res = await fetch(`/api/envios/${envio.id}/recibir`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo recibir el envío.');
        return;
      }
      setRecibido(data);
      setEnvio(null);
      playSound('ok');
    } finally {
      setRecibiendo(false);
    }
  }

  function otraVez() {
    setEnvio(null);
    setRecibido(null);
    setError(null);
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link href="/envios" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Envíos
      </Link>

      {recibido ? (
        <Card className="border-emerald-200 dark:border-emerald-900/50">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <PackageCheck className="h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-ink dark:text-gray-100">✓ Envío recibido correctamente</p>
            <p className="font-mono text-sm text-ink-soft dark:text-gray-400">{recibido.codigo}</p>
            <p className="text-sm font-medium text-ink dark:text-gray-100">
              {recibido.cantidadPaquetes} paquete{recibido.cantidadPaquetes === 1 ? '' : 's'} recibido{recibido.cantidadPaquetes === 1 ? '' : 's'}
            </p>
            <Button className="mt-2" variant="secondary" onClick={otraVez}>
              Recibir otro envío
            </Button>
          </CardContent>
        </Card>
      ) : envio ? (
        <>
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-brand-900 p-6 text-center text-white">
            <Container className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 -rotate-12 text-white/[0.06]" strokeWidth={1} aria-hidden />
            <p className="relative text-xs font-medium uppercase tracking-wide text-gray-400">Envío encontrado</p>
            <p className="relative mt-1 font-mono text-xl font-semibold">{envio.codigo}</p>
            <div className="relative mt-3 flex items-center justify-center gap-2 text-sm text-gray-300">
              <span>{envio.origen.nombre ?? 'Esta instalación'}</span>
              <ArrowRight className="h-3.5 w-3.5 text-brand-400" />
              <span>{envio.destino.nombre}</span>
            </div>
          </div>
          <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-ink-soft dark:text-gray-400">
                  <Package className="h-3.5 w-3.5" /> Paquetes
                </span>
                <span className="font-medium text-ink dark:text-gray-100">{envio.cantidadPaquetes}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft dark:text-gray-400">Estado</span>
                <Badge variant={envio.estado === 'CERRADO' ? 'success' : envio.estado === 'RECIBIDO' ? 'success' : 'neutral'}>
                  {ESTADO_LABEL[envio.estado] ?? envio.estado}
                </Badge>
              </div>
            </div>

            {envio.estado === 'RECIBIDO' ? (
              <p className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-center text-sm text-amber-700 dark:text-amber-400">
                Este envío ya fue recibido anteriormente.
              </p>
            ) : envio.estado !== 'CERRADO' ? (
              <p className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-center text-sm text-amber-700 dark:text-amber-400">
                Este envío todavía no está listo para recibirse.
              </p>
            ) : null}

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={otraVez}>
                Cancelar
              </Button>
              {envio.estado === 'CERRADO' && (
                <Button className="flex-1" onClick={confirmarRecepcion} loading={recibiendo}>
                  <CheckCircle2 className="h-4 w-4" /> Recibir envío
                </Button>
              )}
            </div>
          </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-brand-500" /> Recibir envío
              </CardTitle>
              {modo === 'manual' && <ScannerStatus />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
              <button
                type="button"
                onClick={() => setModo('camara')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold transition-colors',
                  modo === 'camara' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                )}
              >
                <CameraIcon className="h-3.5 w-3.5" /> Escanear QR con cámara
              </button>
              <button
                type="button"
                onClick={() => setModo('manual')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold transition-colors',
                  modo === 'manual' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                )}
              >
                <Keyboard className="h-3.5 w-3.5" /> Introducir código manualmente
              </button>
            </div>

            {modo === 'camara' ? (
              <CameraScanner onDetect={buscar} formats={['qr_code']} textoInstruccion="Apunta la cámara al código QR del envío" />
            ) : (
              <>
                <div
                  onClick={() => inputRef.current?.focus()}
                  className="cursor-text rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-8 text-center"
                >
                  <QrCode className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                  <p className="mb-3 text-sm font-medium text-ink dark:text-gray-100">Escribe el código del envío</p>
                  <Input
                    ref={inputRef}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') buscar(valor);
                    }}
                    placeholder="ENV-20260904-001"
                    className="mx-auto max-w-xs text-center font-mono text-lg"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      inputRef.current?.focus();
                      setMostrarTeclado((v) => !v);
                    }}
                    className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    <Keyboard className="h-3.5 w-3.5" /> {mostrarTeclado ? 'Ocultar teclado' : 'Teclado'}
                  </button>
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Funciona con teclado físico, teclado en pantalla o pegando el código copiado.</p>
                </div>

                {mostrarTeclado && (
                  <div className="mx-auto max-w-sm">
                    <TecladoVirtual onDetect={buscar} />
                  </div>
                )}
              </>
            )}

            {buscando && <p className="text-center text-sm text-gray-400 dark:text-gray-500">Buscando…</p>}

            {error && !buscando && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <Ban className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
