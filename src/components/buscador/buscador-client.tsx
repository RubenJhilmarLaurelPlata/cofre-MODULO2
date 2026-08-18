'use client';

// src/components/buscador/buscador-client.tsx
import * as React from 'react';
import Link from 'next/link';
import {
  Search,
  Wallet,
  Camera as CameraIcon,
  X,
  Truck,
  Archive,
  History as HistoryIcon,
  Info,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { ESTADO_LABELS } from '@/components/ui/status-badge';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { PackageDetailModal } from '@/components/buscador/package-detail-modal';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { reportarEscaneoExitoso } from '@/lib/scanner/hid-provider';
import { onEscaneoCaptureJs } from '@/lib/scanner/capture-js-provider';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { PACKAGE_STATUSES, type PackageStatus } from '@/types';
import type { PackageDetailDTO, HistorialItemDTO } from '@/lib/package-detail';

const ESTADO_PAGO_LABELS: Record<string, string> = { PENDIENTE: 'Pendiente de pago', PARCIAL: 'Pago parcial', PAGADO: 'Pagado' };
const ESTADO_PAGO_VARIANT: Record<string, 'neutral' | 'warning' | 'success'> = { PENDIENTE: 'neutral', PARCIAL: 'warning', PAGADO: 'success' };

interface BuscadorClientProps {
  resultadosIniciales: PackageDetailDTO[];
  limite: number;
  puedeIrAEntrega: boolean;
  puedeEnviarADeposito: boolean;
}

// Compacta ("17 ago · 14:19") — el resto del detalle (remitente,
// destinatario, dias almacenado, observaciones) vive en "Detalle", no en
// la tarjeta de resultado (Fase de correccion: tarjetas mas chicas).
function fmtFechaCorta(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function BuscadorClient({ resultadosIniciales, limite, puedeIrAEntrega, puedeEnviarADeposito }: BuscadorClientProps) {
  const [q, setQ] = React.useState('');
  const [estado, setEstado] = React.useState<PackageStatus | ''>('');
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');
  const [mostrarCamara, setMostrarCamara] = React.useState(false);

  const [resultados, setResultados] = React.useState<PackageDetailDTO[]>(resultadosIniciales);
  const [truncado, setTruncado] = React.useState(false);
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [enviando, setEnviando] = React.useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = React.useState<Record<string, { ok: boolean; mensaje: string }>>({});

  const [modal, setModal] = React.useState<{ code: string; tab: 'detalle' | 'historial' } | null>(null);
  const [historialPorCodigo, setHistorialPorCodigo] = React.useState<Record<string, HistorialItemDTO[]>>({});
  const [cargandoHistorial, setCargandoHistorial] = React.useState<Record<string, boolean>>({});

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const primerRenderRef = React.useRef(true);
  const requestIdRef = React.useRef(0);
  // Se activa justo antes de limpiar "q" despues de un escaneo: evita que
  // el efecto de debounce de abajo (que reacciona a CUALQUIER cambio de
  // q, incluido volver a "") dispare una busqueda SIN filtro 300ms
  // despues y borre en pantalla el resultado del escaneo que se acaba de
  // mostrar — ese era el bug real detras de "escaneo un codigo y
  // aparentemente no lo encuentra" (no era un problema de normalizacion
  // ni de la API: el resultado SI llegaba, pero el debounce lo pisaba
  // enseguida con la lista general).
  const suprimirProximoDebounceRef = React.useRef(false);

  const buscar = React.useCallback(
    // "conSonido" solo se activa en un escaneo explicito (Enter/lector,
    // camara) — no en cada pausa de tipeo del debounce, que seria ruidoso.
    async (qOverride?: string, conSonido = false) => {
      const id = ++requestIdRef.current;
      setCargando(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const qFinal = (qOverride ?? q).trim();
        if (qFinal) params.set('q', qFinal);
        if (estado) params.set('estado', estado);
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);

        const res = await fetch(`/api/buscador/search?${params.toString()}`);
        const data = await res.json();
        if (id !== requestIdRef.current) return;

        if (!res.ok) {
          setError(data.error ?? 'No se pudo completar la búsqueda.');
          if (conSonido) playSound('error');
          return;
        }
        setResultados(data.results);
        setTruncado(data.truncated);
        if (conSonido) {
          playSound(data.results.length > 0 ? 'ok' : 'error');
          reportarEscaneoExitoso();
        }
      } catch {
        if (id !== requestIdRef.current) return;
        setError('Error de conexión. Intenta de nuevo.');
        if (conSonido) playSound('error');
      } finally {
        if (id === requestIdRef.current) setCargando(false);
        // El foco despues de un escaneo real lo recupera el motor unico
        // de cola (ver useScanQueue mas abajo) — aqui no hace falta
        // duplicarlo, y en cada pausa de tipeo del debounce normal el
        // usuario sigue escribiendo, no hay que interrumpirlo.
      }
    },
    [q, estado, desde, hasta]
  );

  // Motor unico de cola (compartido con Recepcion/Entrega/Deposito, ver
  // src/lib/scanner/use-scan-queue.ts): si el operador escanea varios
  // codigos muy rapido (mas rapido de lo que tarda la red), cada uno se
  // busca y se muestra por completo, en orden, en vez de perderse (antes
  // "buscar" no encolaba nada — un escaneo que llegaba mientras el
  // anterior seguia en vuelo simplemente se descartaba en silencio por
  // el guard de requestIdRef).
  const { encolar: encolarEscaneo } = useScanQueue<string>({
    procesar: (code) => buscar(code, true),
    inputRef,
  });

  // Punto de entrada unico para un escaneo real (Enter en el campo,
  // lector HID, camara, CaptureSDK o dictado): normaliza al recibir (ver
  // src/lib/codigo.ts:normalizarEntradaEscaneo) y limpia el campo de
  // inmediato — antes de esperar la respuesta — para que un lector
  // rapido nunca escriba el siguiente codigo encima del anterior (mismo
  // criterio que Recepcion/Entrega). La busqueda en si sigue usando el
  // codigo ya capturado (qOverride), no el estado "q".
  function escanear(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Ver el comentario de suprimirProximoDebounceRef arriba: sin esto,
    // el setQ('') de la linea siguiente dispara igual el efecto de
    // debounce (reacciona a CUALQUIER cambio de "q"), que 300ms despues
    // pisaria el resultado de este escaneo con una busqueda sin filtro.
    suprimirProximoDebounceRef.current = true;
    setQ('');
    if (!code) return;
    encolarEscaneo(code);
  }

  React.useEffect(() => {
    if (primerRenderRef.current) {
      primerRenderRef.current = false;
      return;
    }
    if (suprimirProximoDebounceRef.current) {
      suprimirProximoDebounceRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buscar(), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, estado, desde, hasta]);

  function limpiarFiltros() {
    setQ('');
    setEstado('');
    setDesde('');
    setHasta('');
  }

  // Escaneos por CaptureSDK (si esta habilitado) pasan por el mismo punto
  // de entrada unico (escanear) que HID, camara y Enter en el campo.
  const escanearRef = React.useRef(escanear);
  escanearRef.current = escanear;
  React.useEffect(() => onEscaneoCaptureJs((code) => escanearRef.current(code)), []);

  function onCameraDetect(code: string) {
    escanear(code);
  }

  // Dictado por voz: "Busca La Caserita" o "Busca 76543210" — se quita el
  // verbo inicial y se dispara la busqueda de inmediato, igual que un
  // escaneo (con sonido), sin necesidad de tocar el boton Buscar.
  function onDictado(texto: string) {
    const limpio = texto.trim().replace(/^(busca|buscar)\s+/i, '');
    if (!limpio) return;
    escanear(limpio);
  }

  async function enviarADeposito(code: string) {
    if (enviando[code]) return;
    setEnviando((s) => ({ ...s, [code]: true }));
    try {
      const res = await fetch('/api/deposito/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback((s) => ({ ...s, [code]: { ok: false, mensaje: data.error ?? 'No se pudo enviar a depósito.' } }));
        playSound('error');
        return;
      }
      setResultados((prev) => prev.map((p) => (p.code === code ? data : p)));
      setFeedback((s) => ({ ...s, [code]: { ok: true, mensaje: 'Enviado a depósito.' } }));
      playSound('deposito');
    } catch {
      setFeedback((s) => ({ ...s, [code]: { ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' } }));
      playSound('error');
    } finally {
      setEnviando((s) => ({ ...s, [code]: false }));
    }
  }

  async function cargarHistorial(code: string) {
    if (historialPorCodigo[code] || cargandoHistorial[code]) return;
    setCargandoHistorial((s) => ({ ...s, [code]: true }));
    try {
      const res = await fetch(`/api/buscador/${encodeURIComponent(code)}/historial`);
      if (res.ok) {
        const data: HistorialItemDTO[] = await res.json();
        setHistorialPorCodigo((s) => ({ ...s, [code]: data }));
      }
    } finally {
      setCargandoHistorial((s) => ({ ...s, [code]: false }));
    }
  }

  function abrirModal(code: string, tab: 'detalle' | 'historial') {
    setModal({ code, tab });
    if (tab === 'historial') cargarHistorial(code);
  }

  function cambiarTabModal(tab: 'detalle' | 'historial') {
    if (!modal) return;
    setModal({ ...modal, tab });
    if (tab === 'historial') cargarHistorial(modal.code);
  }

  const paqueteModal = modal ? resultados.find((p) => p.code === modal.code) : undefined;
  const hayFiltrosActivos = !!(q || estado || desde || hasta);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Buscador</CardTitle>
            <ScannerStatus />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') escanear(q);
                }}
                placeholder="Código, nombre, teléfono…"
                className="pl-9 pr-11 font-mono"
              />
              <VoiceInputButton onResult={onDictado} className="absolute right-1 top-1/2 -translate-y-1/2" />
            </div>
            <Button variant="secondary" onClick={() => setMostrarCamara((v) => !v)} className="sm:w-auto">
              <CameraIcon className="h-4 w-4" /> {mostrarCamara ? 'Ocultar cámara' : 'Cámara'}
            </Button>
            {hayFiltrosActivos && (
              <Button variant="ghost" onClick={limpiarFiltros} className="sm:w-auto">
                <X className="h-4 w-4" /> Limpiar
              </Button>
            )}
          </div>

          {mostrarCamara && (
            <div className="mx-auto max-w-sm">
              <CameraScanner onDetect={onCameraDetect} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Estado</label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as PackageStatus | '')}
                className="h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Todos los estados</option>
                {PACKAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ESTADO_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Ingresó desde</label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Ingresó hasta</label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-ink-soft dark:text-gray-400">
        <span>
          {cargando
            ? 'Buscando…'
            : hayFiltrosActivos
              ? `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`
              : `${resultados.length} paquete${resultados.length === 1 ? '' : 's'} más reciente${resultados.length === 1 ? '' : 's'}`}
        </span>
        {truncado && <span className="flex items-center gap-1 text-xs text-amber-600"><Info className="h-3.5 w-3.5" /> Mostrando los primeros {limite}. Afina la búsqueda para ver menos resultados.</span>}
      </div>

      {resultados.length === 0 && !cargando ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-3 text-gray-400 dark:text-gray-500">
          <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <p className="text-sm">No se encontró ningún paquete con esos criterios.</p>
        </div>
      ) : (
        // Tarjetas compactas (correccion): solo lo esencial para reconocer
        // el paquete de un vistazo (codigo, estado, fecha, monto/estado de
        // pago). Remitente, destinatario, dias almacenado y observaciones
        // se movieron a "Detalle" (ya los muestra por completo, ver
        // package-detail-modal.tsx) — antes se repetian aqui, ocupando casi
        // toda la pantalla en movil.
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resultados.map((p) => {
            const fb = feedback[p.code];
            const puedeEnviar = puedeEnviarADeposito && p.status === 'EN_PAQUETERIA';
            return (
              <Card key={p.code}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-base font-bold text-ink dark:text-gray-100">{p.code}</p>
                    <StatusBadge status={p.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
                    <span>{fmtFechaCorta(p.ingresoAt)}</span>
                    {p.origenEntrega === 'IMPORTACION' && (
                      <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft dark:text-gray-400">
                        Importación{p.lote ? ` · ${p.lote}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-sm">
                    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold text-ink dark:text-gray-100">
                      <Wallet className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
                      {p.moneda} {p.montoPagado.toFixed(2)} / {p.costoAcumulado.toFixed(2)}
                    </span>
                    <Badge variant={ESTADO_PAGO_VARIANT[p.estadoPago] ?? 'neutral'}>{ESTADO_PAGO_LABELS[p.estadoPago] ?? p.estadoPago}</Badge>
                  </div>

                  {fb && (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg p-2 text-xs',
                        fb.ok ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                      )}
                    >
                      {fb.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                      {fb.mensaje}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 border-t border-gray-100 dark:border-gray-800/60 pt-2.5">
                    <Button size="sm" variant="secondary" onClick={() => abrirModal(p.code, 'detalle')}>
                      <Info className="h-3.5 w-3.5" /> Detalle
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => abrirModal(p.code, 'historial')}>
                      <HistoryIcon className="h-3.5 w-3.5" /> Historial
                    </Button>
                    {puedeIrAEntrega && (
                      <Link href={`/entrega?code=${encodeURIComponent(p.code)}`}>
                        <Button size="sm" variant="secondary">
                          <Truck className="h-3.5 w-3.5" /> Entrega
                        </Button>
                      </Link>
                    )}
                    {puedeEnviar && (
                      <Button size="sm" variant="secondary" loading={!!enviando[p.code]} onClick={() => enviarADeposito(p.code)}>
                        <Archive className="h-3.5 w-3.5" /> Depósito
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {modal && paqueteModal && (
        <PackageDetailModal
          detalle={paqueteModal}
          tab={modal.tab}
          onTabChange={cambiarTabModal}
          historial={historialPorCodigo[modal.code]}
          cargandoHistorial={!!cargandoHistorial[modal.code]}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
