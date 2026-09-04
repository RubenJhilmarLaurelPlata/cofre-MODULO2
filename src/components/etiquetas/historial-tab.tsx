'use client';

// src/components/etiquetas/historial-tab.tsx
import * as React from 'react';
import { Search, Printer, Copy, XCircle, CheckCircle2, User, Calendar, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SerieInfo, PrefillDuplicado } from '@/components/etiquetas/generar-tab';
import type { LoteDTO } from '@/lib/etiquetas';

interface HistorialTabProps {
  esAdmin: boolean;
  series: SerieInfo[];
  onDuplicar: (prefill: PrefillDuplicado) => void;
}

function fmtFechaCorta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function HistorialTab({ esAdmin, series, onDuplicar }: HistorialTabProps) {
  const [q, setQ] = React.useState('');
  const [inicial, setInicial] = React.useState('');
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');

  const [lotes, setLotes] = React.useState<LoteDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reimprimiendo, setReimprimiendo] = React.useState<Record<string, boolean>>({});

  // Eliminar lote (ver eliminarLoteEtiquetas en src/lib/etiquetas.ts):
  // "eliminandoId" evita doble click sobre el mismo lote; "mensaje" es el
  // aviso de éxito/error de la última operación. El servidor es quien
  // decide de verdad si se puede eliminar (lote.puedeEliminarse solo
  // deshabilita el botón de antemano, nunca se salta la validación real).
  const [eliminandoId, setEliminandoId] = React.useState<string | null>(null);
  const [mensaje, setMensaje] = React.useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const primerRenderRef = React.useRef(true);

  const buscar = React.useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (inicial) params.set('inicial', inicial);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const res = await fetch(`/api/etiquetas/lotes?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cargar el historial.');
        return;
      }
      setLotes(data);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [q, inicial, desde, hasta]);

  React.useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (primerRenderRef.current) {
      primerRenderRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(buscar, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, inicial, desde, hasta]);

  async function reimprimirLote(lote: LoteDTO) {
    if (reimprimiendo[lote.id]) return;
    setReimprimiendo((s) => ({ ...s, [lote.id]: true }));
    setError(null);
    try {
      const resBusqueda = await fetch('/api/etiquetas/reimprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'lote', batchId: lote.id }),
      });
      const busqueda = await resBusqueda.json();
      if (!resBusqueda.ok) {
        setError(busqueda.error ?? 'No se pudo reimprimir el lote.');
        return;
      }

      const resPdf = await fetch('/api/etiquetas/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: busqueda.codigos }),
      });
      if (!resPdf.ok) {
        const data = await resPdf.json().catch(() => null);
        setError(data?.error ?? 'No se pudo generar el PDF.');
        return;
      }
      const blob = await resPdf.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `etiquetas-lote-${lote.inicial}-${lote.primerConsecutivo}-${lote.ultimoConsecutivo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setReimprimiendo((s) => ({ ...s, [lote.id]: false }));
    }
  }

  async function eliminarLote(lote: LoteDTO) {
    if (eliminandoId) return;
    const confirmado = window.confirm(
      `¿Eliminar este lote?\n\n${lote.inicial}${lote.separador}${lote.primerConsecutivo} → ${lote.inicial}${lote.separador}${lote.ultimoConsecutivo} (${lote.cantidad} etiquetas)\n\n` +
        'Esta acción eliminará únicamente el registro de generación de etiquetas. No eliminará paquetes, pagos ni entregas — solo se permite si ningún código de este lote fue usado todavía.'
    );
    if (!confirmado) return;

    setEliminandoId(lote.id);
    setMensaje(null);
    try {
      const res = await fetch(`/api/etiquetas/lotes/${lote.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error ?? 'No se pudo eliminar el lote.' });
        return;
      }
      setLotes((prev) => prev.filter((l) => l.id !== lote.id));
      setMensaje({ tipo: 'exito', texto: `Lote "${lote.inicial}" eliminado correctamente.` });
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setEliminandoId(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Historial de lotes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Observaciones o usuario…" className="pl-9" />
            </div>
            <select
              value={inicial}
              onChange={(e) => setInicial(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Todas las iniciales</option>
              {series.map((s) => (
                <option key={s.inicial} value={s.inicial}>
                  {s.inicial}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Generado desde</label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Generado hasta</label>
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

      {mensaje && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border p-3 text-sm',
            mensaje.tipo === 'exito'
              ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
          )}
        >
          {mensaje.tipo === 'exito' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          {mensaje.texto}
        </div>
      )}

      {cargando ? (
        <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando historial…</p>
      ) : lotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-gray-400 dark:text-gray-500">
            <Search className="mb-3 h-8 w-8" strokeWidth={1.5} />
            <p className="text-sm">No se encontró ningún lote con esos criterios.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lotes.map((lote) => (
            <Card key={lote.id}>
              <CardContent className="flex flex-col gap-3 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-lg font-bold text-ink dark:text-gray-100">
                    {lote.inicial}
                    {lote.separador}
                    {lote.primerConsecutivo} → {lote.inicial}
                    {lote.separador}
                    {lote.ultimoConsecutivo}
                  </p>
                  <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-ink-soft dark:text-gray-400">{lote.cantidad} etiquetas</span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-gray-400">
                  <Calendar className="h-3.5 w-3.5" />
                  {lote.fechaInicio === lote.fechaFin ? fmtFechaCorta(lote.fechaInicio) : `${fmtFechaCorta(lote.fechaInicio)} → ${fmtFechaCorta(lote.fechaFin)}`}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-gray-400">
                  <User className="h-3.5 w-3.5" /> {lote.generadoPor} · {fmtFechaHora(lote.createdAt)}
                </div>
                {lote.observaciones && <p className="text-xs text-ink-soft dark:text-gray-400">{lote.observaciones}</p>}

                <div className="mt-auto flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-800/60 pt-3">
                  <Button size="sm" variant="secondary" loading={!!reimprimiendo[lote.id]} onClick={() => reimprimirLote(lote)}>
                    <Printer className="h-3.5 w-3.5" /> Reimprimir
                  </Button>
                  {esAdmin && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onDuplicar({ inicial: lote.inicial, cantidadPorDia: lote.cantidadPorDia, observaciones: lote.observaciones })}
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicar
                    </Button>
                  )}
                  {esAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={lote.puedeEliminarse ? 'Eliminar lote' : 'Este lote ya tiene códigos usados en paquetes reales y no puede eliminarse'}
                      aria-label="Eliminar lote"
                      disabled={!lote.puedeEliminarse || eliminandoId === lote.id}
                      onClick={() => eliminarLote(lote)}
                      className="ml-auto text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      {eliminandoId === lote.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Eliminar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
