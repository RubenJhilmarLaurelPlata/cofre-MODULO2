'use client';

// src/components/envios/envio-detalle-client.tsx
// Fase 2.1: flujo directo — escanear un código que todavía no existe lo
// registra y lo reserva en un solo paso (ver agregarPaquete() en
// src/lib/envios.ts), sin pasar primero por Recepción. Corrección final:
// datos opcionales de quien recogerá (reutiliza Package.destinatario/
// destinatarioTelefono, los mismos campos que ya usa Recepción — nunca
// una estructura paralela), botón de teclado explícito para cuando un
// lector Bluetooth oculta el teclado del dispositivo, y dictado por voz
// opcional para el nombre (Web Speech API del navegador, sin backend
// propio ni almacenamiento de audio).
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Container, ScanLine, Trash2, CheckCircle2, XCircle, Lock, Ban, RefreshCw, QrCode, PackageCheck, Keyboard, Camera as CameraIcon, UserRound, Phone, Wallet, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { TecladoVirtual } from '@/components/scanner/teclado-virtual';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { getEstadoEnvioInfo } from '@/components/envios/estado-envio';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { playSound } from '@/lib/sound';
import { cn } from '@/lib/utils';

type EstadoPagoEnvioItem = 'PENDIENTE' | 'PAGADO';

interface EnvioItemDTO {
  id: string;
  packageId: string;
  code: string;
  status: string;
  ingresoAt: string;
  createdAt: string;
  destinatario: string | null;
  destinatarioTelefono: string | null;
  estadoPago: EstadoPagoEnvioItem;
  montoPagado: number;
}
interface EnvioDetalleDTO {
  id: string;
  codigo: string;
  estado: string;
  destino: { id: string; codigo: string; nombre: string; ciudad: string | null };
  origen: { codigo: string | null; nombre: string | null };
  cantidadPaquetes: number;
  creadoPor: string | null;
  cerradoPor: string | null;
  createdAt: string;
  cerradoAt: string | null;
  qrToken: string | null;
  items: EnvioItemDTO[];
  resumenPago: { pagados: number; pendientes: number; fondosDestino: number };
}

interface ItemEscaneado {
  code: string;
  destinatario?: string;
  destinatarioTelefono?: string;
  estadoPago?: EstadoPagoEnvioItem;
  monto?: number;
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function EnvioDetalleClient({ envioId }: { envioId: string }) {
  const [envio, setEnvio] = React.useState<EnvioDetalleDTO | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState('');
  const [destinatario, setDestinatario] = React.useState('');
  const [destinatarioTelefono, setDestinatarioTelefono] = React.useState('');
  const [estadoPago, setEstadoPago] = React.useState<EstadoPagoEnvioItem>('PENDIENTE');
  const [monto, setMonto] = React.useState('');
  const [qrError, setQrError] = React.useState(false);
  const [qrIntento, setQrIntento] = React.useState(0);
  const [ultimoScan, setUltimoScan] = React.useState<{ ok: boolean; code: string; mensaje: string } | null>(null);
  const [cerrando, setCerrando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [confirmarCierre, setConfirmarCierre] = React.useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = React.useState(false);
  const [mostrarCamara, setMostrarCamara] = React.useState(false);
  const [mostrarTeclado, setMostrarTeclado] = React.useState(false);
  const [campoListo, setCampoListo] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const cargar = React.useCallback(async () => {
    const res = await fetch(`/api/envios/${envioId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'No se pudo cargar el envío.');
      return;
    }
    setEnvio(data);
  }, [envioId]);

  React.useEffect(() => {
    setCargando(true);
    cargar().finally(() => setCargando(false));
  }, [cargar]);

  async function procesarAgregar(item: ItemEscaneado) {
    const res = await fetch(`/api/envios/${envioId}/paquetes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (!res.ok) {
      setUltimoScan({ ok: false, code: item.code, mensaje: data.error ?? 'No se pudo agregar el paquete.' });
      playSound('error');
      return;
    }
    setEnvio(data);
    setUltimoScan({ ok: true, code: item.code, mensaje: 'Agregado al envío.' });
    playSound('ok');
  }

  const { encolar, procesando } = useScanQueue<ItemEscaneado>({
    procesar: procesarAgregar,
    inputRef,
    debeEnfocar: () => envio?.estado === 'BORRADOR',
  });

  function agregar(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    setValor('');
    if (!code) return;
    const montoNum = parseFloat(monto);
    encolar({
      code,
      destinatario: destinatario.trim() || undefined,
      destinatarioTelefono: destinatarioTelefono.trim() || undefined,
      estadoPago,
      monto: estadoPago === 'PAGADO' && !Number.isNaN(montoNum) ? montoNum : undefined,
    });
    // Listo para el siguiente escaneo: nunca hay que borrar a mano.
    setDestinatario('');
    setDestinatarioTelefono('');
    setEstadoPago('PENDIENTE');
    setMonto('');
  }

  /**
   * Botón "Teclado" (sección 1/2 del pedido): en Mac/Windows no existe
   * ningún "teclado virtual" que forzar — no hay nada que inventar ahí,
   * así que solo enfoca el campo. En móvil, un `.focus()` disparado por
   * un gesto directo del usuario (este click) es lo único que un
   * navegador puede usar para decidir mostrar su teclado nativo — no hay
   * ninguna API que lo garantice más allá de eso. Para que el botón
   * nunca "no haga nada visible" en NINGUNA plataforma, además muestra
   * el teclado en pantalla completo (TecladoVirtual, ya usado en
   * Buscador/Depósito para este mismo problema real: un lector
   * Bluetooth que oculta el teclado del dispositivo) y resalta el campo
   * un instante — así siempre hay una confirmación visual clara.
   */
  function alternarTeclado() {
    inputRef.current?.focus();
    setMostrarTeclado((v) => !v);
    setCampoListo(true);
    setTimeout(() => setCampoListo(false), 900);
  }

  async function quitar(item: EnvioItemDTO) {
    const res = await fetch(`/api/envios/${envioId}/paquetes/${item.packageId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'No se pudo quitar el paquete.');
      return;
    }
    setEnvio(data);
  }

  async function cerrar() {
    setCerrando(true);
    setError(null);
    try {
      const res = await fetch(`/api/envios/${envioId}/cerrar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cerrar el envío.');
        return;
      }
      setEnvio(data);
      setConfirmarCierre(false);
    } finally {
      setCerrando(false);
    }
  }

  async function cancelar() {
    setCancelando(true);
    setError(null);
    try {
      const res = await fetch(`/api/envios/${envioId}/cancelar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cancelar el envío.');
        return;
      }
      setEnvio(data);
      setConfirmarCancelar(false);
    } finally {
      setCancelando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;
  if (!envio) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error ?? 'No se encontró el envío.'}</CardContent>
      </Card>
    );
  }

  const badge = getEstadoEnvioInfo(envio.estado);
  const esBorrador = envio.estado === 'BORRADOR';
  const yaEnCamino = envio.estado === 'CERRADO' || envio.estado === 'RECIBIDO';

  return (
    <div className="space-y-5">
      <Link href="/envios" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Envíos
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-brand-900 p-6 text-white shadow-sm">
            <Container className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 -rotate-12 text-white/[0.06]" strokeWidth={1} aria-hidden />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-500/30">
                  <Container className="h-5 w-5 text-brand-400" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-lg font-semibold leading-tight">Envío a {envio.destino.nombre}</p>
                  <p className="font-mono text-sm text-gray-300">{envio.codigo}</p>
                </div>
              </div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="relative mt-3 text-xs text-gray-400">
              Creado {fmtFecha(envio.createdAt)}{envio.creadoPor && ` por ${envio.creadoPor}`}
              {envio.cerradoAt && (
                <>
                  {' · '}Cerrado {fmtFecha(envio.cerradoAt)}
                  {envio.cerradoPor && ` por ${envio.cerradoPor}`}
                </>
              )}
            </p>
          </div>

          {esBorrador && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Escanear paquetes</CardTitle>
                  <ScannerStatus />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  onClick={() => inputRef.current?.focus()}
                  className={cn(
                    'cursor-text rounded-xl border-2 border-dashed p-8 text-center transition-colors',
                    campoListo ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10' : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'
                  )}
                >
                  <ScanLine className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                  <Input
                    ref={inputRef}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') agregar(valor);
                    }}
                    placeholder="Escanea o escribe el código"
                    className="mx-auto max-w-xs text-center font-mono text-lg"
                    autoFocus
                  />
                  {campoListo && <p className="mt-2 text-xs font-medium text-brand-600 dark:text-brand-400">Listo para escribir ✓</p>}
                  <div className="mx-auto mt-3 flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMostrarCamara((v) => !v);
                        if (!mostrarCamara) setMostrarTeclado(false);
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      <CameraIcon className="h-3.5 w-3.5" /> {mostrarCamara ? 'Ocultar cámara' : 'Cámara'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        alternarTeclado();
                        if (!mostrarTeclado) setMostrarCamara(false);
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      <Keyboard className="h-3.5 w-3.5" /> {mostrarTeclado ? 'Ocultar teclado' : 'Teclado'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    Si el código todavía no existe en el sistema, se registra automáticamente. No hace falta pasar antes por Recepción.
                  </p>
                </div>

                {mostrarCamara && (
                  <div className="mx-auto max-w-sm" onClick={(e) => e.stopPropagation()}>
                    <CameraScanner onDetect={agregar} />
                  </div>
                )}

                {mostrarTeclado && (
                  <div className="mx-auto max-w-sm" onClick={(e) => e.stopPropagation()}>
                    <TecladoVirtual onDetect={agregar} />
                  </div>
                )}

                <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                  <p className="mb-3 text-sm font-medium text-ink dark:text-gray-100">
                    Información de quien recogerá <span className="font-normal text-gray-400 dark:text-gray-500">(Opcional)</span>
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={destinatario}
                        onChange={(e) => setDestinatario(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') agregar(valor);
                        }}
                        placeholder="Nombre"
                        className="h-11 pl-9 pr-10 text-base"
                      />
                      <VoiceInputButton
                        onResult={(texto) => setDestinatario((actual) => (actual ? `${actual} ${texto}` : texto))}
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                        mostrarSiNoSoportado
                      />
                    </div>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={destinatarioTelefono}
                        onChange={(e) => setDestinatarioTelefono(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') agregar(valor);
                        }}
                        placeholder="Celular"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        className="h-11 pl-9 text-base"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink dark:text-gray-100">
                    <Wallet className="h-4 w-4 text-brand-500" /> Pago en destino
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEstadoPago('PENDIENTE')}
                      className={cn(
                        'rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors',
                        estadoPago === 'PENDIENTE'
                          ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                          : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400'
                      )}
                    >
                      Pendiente
                    </button>
                    <button
                      type="button"
                      onClick={() => setEstadoPago('PAGADO')}
                      className={cn(
                        'rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors',
                        estadoPago === 'PAGADO'
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                          : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400'
                      )}
                    >
                      Pagado
                    </button>
                  </div>
                  {estadoPago === 'PAGADO' && (
                    <div className="mt-3">
                      <Input
                        value={monto}
                        onChange={(e) => setMonto(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') agregar(valor);
                        }}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="Monto entregado (ej: 2.00)"
                        className="h-11 text-base"
                      />
                      <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                        Lo que el cliente entregó aquí para el destino — no la tarifa de esta sucursal.
                      </p>
                    </div>
                  )}
                </div>

                <Button className="w-full" size="lg" onClick={() => agregar(valor)} disabled={!valor.trim()}>
                  Agregar paquete
                </Button>

                {ultimoScan && (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-xl border-2 p-3',
                      ultimoScan.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40' : 'border-red-200 dark:border-red-900/50 bg-red-50/40'
                    )}
                  >
                    {ultimoScan.ok ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" /> : <XCircle className="h-6 w-6 shrink-0 text-red-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold text-ink dark:text-gray-100">{ultimoScan.code}</p>
                      <p className={cn('text-xs', ultimoScan.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{ultimoScan.mensaje}</p>
                    </div>
                    {procesando && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{envio.items.length} paquete{envio.items.length === 1 ? '' : 's'}</CardTitle>
            </CardHeader>
            <CardContent>
              {envio.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se agregó ningún paquete.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {envio.items.map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0 space-y-0.5">
                        <span className="flex items-center gap-2 font-mono font-medium text-ink dark:text-gray-100">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {it.code}
                        </span>
                        {it.destinatario && (
                          <p className="truncate pl-6 text-xs text-gray-400 dark:text-gray-500">
                            {it.destinatario}
                            {it.destinatarioTelefono && ` · ${it.destinatarioTelefono}`}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={it.estadoPago === 'PAGADO' ? 'success' : 'warning'}>
                          {it.estadoPago === 'PAGADO' ? `Pagado Bs ${it.montoPagado.toFixed(2)}` : 'Pendiente'}
                        </Badge>
                        {esBorrador && (
                          <Button variant="ghost" size="sm" onClick={() => quitar(it)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {envio.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-brand-500" /> Resumen
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft dark:text-gray-400">Paquetes</span>
                  <span className="font-medium text-ink dark:text-gray-100">{envio.cantidadPaquetes}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft dark:text-gray-400">Pagados</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{envio.resumenPago.pagados}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft dark:text-gray-400">Pendientes</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">{envio.resumenPago.pendientes}</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 pt-2">
                  <span className="font-medium text-ink dark:text-gray-100">Fondos para {envio.destino.nombre}</span>
                  <span className="font-semibold text-brand-600 dark:text-brand-400">Bs {envio.resumenPago.fondosDestino.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {esBorrador && (
            <Card>
              <CardHeader>
                <CardTitle>Acciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!confirmarCierre ? (
                  <Button className="w-full" size="lg" disabled={envio.items.length === 0} onClick={() => setConfirmarCierre(true)}>
                    <Lock className="h-4 w-4" /> Cerrar envío
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Al cerrar, este envío queda <strong>inmutable</strong>: no podrás agregar ni quitar paquetes. Se generará su código QR.
                    </p>
                    {envio.resumenPago.fondosDestino > 0 && (
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Fondos para {envio.destino.nombre}: <strong>Bs {envio.resumenPago.fondosDestino.toFixed(2)}</strong> ({envio.resumenPago.pagados} pagado{envio.resumenPago.pagados === 1 ? '' : 's'}).
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={cerrar} loading={cerrando}>
                        Confirmar cierre
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmarCierre(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {!confirmarCancelar ? (
                  <Button className="w-full" variant="destructive" onClick={() => setConfirmarCancelar(true)}>
                    <Ban className="h-4 w-4" /> Cancelar envío
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3">
                    <p className="text-xs text-red-800 dark:text-red-400">Se cancelará este envío y sus paquetes quedarán libres para otro envío. Esta acción no se puede deshacer.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={cancelar} loading={cancelando}>
                        Confirmar cancelación
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmarCancelar(false)}>
                        Volver
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {yaEnCamino && envio.qrToken && (
            <Card className="border-emerald-200 dark:border-emerald-900/50">
              <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <div>
                  <p className="text-base font-semibold text-ink dark:text-gray-100">Envío preparado</p>
                  <p className="font-mono text-sm text-ink-soft dark:text-gray-400">{envio.codigo}</p>
                </div>
                <p className="text-sm text-ink-soft dark:text-gray-400">
                  {envio.origen.nombre ?? 'Esta instalación'} → {envio.destino.nombre}
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">
                  {envio.cantidadPaquetes} paquete{envio.cantidadPaquetes === 1 ? '' : 's'}
                </p>

                {envio.estado === 'RECIBIDO' && (
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <PackageCheck className="h-3.5 w-3.5" /> Recibido
                  </div>
                )}

                <div className="flex items-center gap-1.5 pt-2 text-xs font-medium text-gray-400 dark:text-gray-500">
                  <QrCode className="h-3.5 w-3.5" /> QR del envío
                </div>
                {qrError ? (
                  <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-center">
                    <XCircle className="h-6 w-6 text-red-500" />
                    <p className="text-xs text-red-700 dark:text-red-400">No se pudo cargar el QR. Verifica tu sesión.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQrError(false);
                        setQrIntento((n) => n + 1);
                      }}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" /> Reintentar
                    </button>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/envios/${envio.id}/qr${qrIntento > 0 ? `?intento=${qrIntento}` : ''}`}
                    alt={`QR del envío ${envio.codigo}`}
                    onError={() => setQrError(true)}
                    className="h-48 w-48 rounded-lg border border-gray-100 dark:border-gray-800"
                  />
                )}
                <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                  Al llegar a destino, escanea este código desde Envíos → Recibir envío. Si la cámara no puede
                  leerlo, también puedes escribir el código <span className="font-mono font-medium text-ink-soft dark:text-gray-300">{envio.codigo}</span> manualmente.
                </p>
              </CardContent>
            </Card>
          )}

          {envio.estado === 'CANCELADO' && (
            <Card>
              <CardContent className="flex items-center gap-2 py-4 text-sm text-gray-400 dark:text-gray-500">
                <Ban className="h-4 w-4" /> Este envío fue cancelado. Sus paquetes ya están disponibles para otros envíos.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
