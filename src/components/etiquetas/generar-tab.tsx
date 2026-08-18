'use client';

// src/components/etiquetas/generar-tab.tsx
import * as React from 'react';
import { Wand2, ArrowRight, RotateCcw, Download, CheckCircle2, XCircle, Clock3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LabelPreview } from '@/components/etiquetas/label-preview';
import { MesLetrasConfig } from '@/components/etiquetas/mes-letras-config';
import type { LabelDescriptor, LoteDTO } from '@/lib/etiquetas';

export interface SerieInfo {
  inicial: string;
  descripcion: string;
  correlativo: number;
}

export interface PrefillDuplicado {
  inicial: string;
  cantidadPorDia: number;
  observaciones: string;
}

interface GenerarTabProps {
  series: SerieInfo[];
  monthLetters: Record<number, string>;
  separadorDefault: string;
  prefill: PrefillDuplicado | null;
  onPrefillConsumido: () => void;
  onCorrelativoActualizado: (inicial: string, nuevoCorrelativo: number) => void;
  onMonthLettersGuardadas: (letras: Record<number, string>) => void;
}

type Modo = 'hoy' | 'manana' | 'especifica' | 'semana' | 'rango';

const PREVIEW_LIMIT = 30;

function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFechaCorta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

function calcularNumDias(modo: Modo, fechaInicio: string, fechaFin: string): number {
  if (modo === 'semana') return 7;
  if (modo === 'rango') {
    const a = new Date(`${fechaInicio}T00:00:00`);
    const b = new Date(`${fechaFin}T00:00:00`);
    const dias = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
    return dias > 0 ? dias : 0;
  }
  return 1;
}

export function GenerarTab({
  series,
  monthLetters,
  separadorDefault,
  prefill,
  onPrefillConsumido,
  onCorrelativoActualizado,
  onMonthLettersGuardadas,
}: GenerarTabProps) {
  const [inicial, setInicial] = React.useState(series[0]?.inicial ?? '');
  const [descripcionNueva, setDescripcionNueva] = React.useState('');
  const [modo, setModo] = React.useState<Modo>('hoy');
  const [fecha, setFecha] = React.useState(hoyStr());
  const [fechaReferencia, setFechaReferencia] = React.useState(hoyStr());
  const [fechaInicio, setFechaInicio] = React.useState(hoyStr());
  const [fechaFin, setFechaFin] = React.useState(hoyStr());
  const [cantidadPorDia, setCantidadPorDia] = React.useState(30);
  const [consecutivoInicial, setConsecutivoInicial] = React.useState(1);
  const [observaciones, setObservaciones] = React.useState('');

  const [ultimoLote, setUltimoLote] = React.useState<LoteDTO | null>(null);
  const [cargandoUltimoLote, setCargandoUltimoLote] = React.useState(false);

  const [generando, setGenerando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<{ batchId: string; codigos: LabelDescriptor[] } | null>(null);
  const [descargando, setDescargando] = React.useState(false);

  const serieExistente = series.find((s) => s.inicial === inicial);
  const esNueva = inicial.trim().length > 0 && !serieExistente;
  const numDias = calcularNumDias(modo, fechaInicio, fechaFin);
  const cantidadTotal = cantidadPorDia * numDias;

  React.useEffect(() => {
    if (prefill) {
      setInicial(prefill.inicial);
      setCantidadPorDia(prefill.cantidadPorDia);
      setObservaciones(prefill.observaciones);
      setModo('hoy');
      setFecha(hoyStr());
      setResultado(null);
      setError(null);
      onPrefillConsumido();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  React.useEffect(() => {
    if (!inicial.trim()) {
      setUltimoLote(null);
      return;
    }
    let activo = true;
    setCargandoUltimoLote(true);
    fetch(`/api/etiquetas/lotes?inicial=${encodeURIComponent(inicial.trim().toUpperCase())}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: LoteDTO[]) => {
        if (activo) setUltimoLote(data[0] ?? null);
      })
      .catch(() => {
        if (activo) setUltimoLote(null);
      })
      .finally(() => {
        if (activo) setCargandoUltimoLote(false);
      });
    return () => {
      activo = false;
    };
  }, [inicial]);

  function continuarLote() {
    const base = ultimoLote?.ultimoConsecutivo ?? serieExistente?.correlativo ?? 0;
    setConsecutivoInicial(base + 1);
  }

  function nuevoLote() {
    setConsecutivoInicial(1);
  }

  async function generar() {
    if (generando) return;
    setGenerando(true);
    setError(null);
    setResultado(null);
    try {
      const body: Record<string, unknown> = {
        inicial: inicial.trim().toUpperCase(),
        descripcionNuevaSerie: esNueva ? descripcionNueva : undefined,
        modo,
        cantidadPorDia,
        consecutivoInicial,
        observaciones,
      };
      if (modo === 'especifica') body.fecha = fecha;
      if (modo === 'semana') body.fechaReferencia = fechaReferencia;
      if (modo === 'rango') {
        body.fechaInicio = fechaInicio;
        body.fechaFin = fechaFin;
      }

      const res = await fetch('/api/etiquetas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo generar el lote.');
        return;
      }
      setResultado({ batchId: data.batchId, codigos: data.codigos });
      onCorrelativoActualizado(inicial.trim().toUpperCase(), data.ultimoConsecutivo);
      setUltimoLote({
        id: data.batchId,
        inicial: inicial.trim().toUpperCase(),
        fechaInicio: data.codigos[0]?.fecha ?? hoyStr(),
        fechaFin: data.codigos[data.codigos.length - 1]?.fecha ?? hoyStr(),
        cantidadPorDia,
        cantidad: data.codigos.length,
        separador: separadorDefault,
        primerConsecutivo: data.primerConsecutivo,
        ultimoConsecutivo: data.ultimoConsecutivo,
        observaciones,
        generadoPor: 'Tú',
        createdAt: new Date().toISOString(),
      });
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }

  async function descargarPdf() {
    if (!resultado || descargando) return;
    setDescargando(true);
    try {
      const res = await fetch('/api/etiquetas/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: resultado.codigos }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'No se pudo generar el PDF.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `etiquetas-${resultado.codigos[0]?.code ?? 'lote'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Error de conexión al descargar el PDF.');
    } finally {
      setDescargando(false);
    }
  }

  const MODOS: Array<{ id: Modo; label: string }> = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'manana', label: 'Mañana' },
    { id: 'especifica', label: 'Fecha específica' },
    { id: 'semana', label: 'Semana completa' },
    { id: 'rango', label: 'Rango de fechas' },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Tipo y fecha</CardTitle>
              <MesLetrasConfig letras={monthLetters} onGuardado={onMonthLettersGuardadas} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="inicial">Tipo (inicial)</Label>
                <Input
                  id="inicial"
                  list="series-datalist"
                  value={inicial}
                  onChange={(e) => setInicial(e.target.value.toUpperCase().slice(0, 4))}
                  className="mt-1 font-mono uppercase"
                  placeholder="M, S, P, L, X…"
                />
                <datalist id="series-datalist">
                  {series.map((s) => (
                    <option key={s.inicial} value={s.inicial}>
                      {s.descripcion}
                    </option>
                  ))}
                </datalist>
              </div>
              {esNueva && (
                <div>
                  <Label htmlFor="descripcionNueva">Descripción de la nueva serie</Label>
                  <Input
                    id="descripcionNueva"
                    value={descripcionNueva}
                    onChange={(e) => setDescripcionNueva(e.target.value)}
                    className="mt-1"
                    placeholder={`Serie ${inicial || '…'}`}
                  />
                </div>
              )}
            </div>
            {esNueva && (
              <p className="text-xs text-amber-600">
                &quot;{inicial}&quot; es una inicial nueva — se creará como serie al generar este lote.
              </p>
            )}

            <div>
              <Label>Fecha correspondiente</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {MODOS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModo(m.id)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      modo === m.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700' : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {modo === 'especifica' && (
              <div className="max-w-xs">
                <Label htmlFor="fecha">Fecha</Label>
                <Input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1" />
              </div>
            )}
            {modo === 'semana' && (
              <div className="max-w-xs">
                <Label htmlFor="fechaReferencia">Cualquier fecha de esa semana</Label>
                <Input
                  id="fechaReferencia"
                  type="date"
                  value={fechaReferencia}
                  onChange={(e) => setFechaReferencia(e.target.value)}
                  className="mt-1"
                />
              </div>
            )}
            {modo === 'rango' && (
              <div className="grid max-w-md grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="fechaInicio">Desde</Label>
                  <Input id="fechaInicio" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="fechaFin">Hasta</Label>
                  <Input id="fechaFin" type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} min={fechaInicio} className="mt-1" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cantidad y consecutivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="cantidadPorDia">{numDias > 1 ? 'Cantidad por día' : 'Cantidad'}</Label>
                <Input
                  id="cantidadPorDia"
                  type="number"
                  min={1}
                  max={5000}
                  value={cantidadPorDia}
                  onChange={(e) => setCantidadPorDia(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="consecutivoInicial">Consecutivo inicial</Label>
                <Input
                  id="consecutivoInicial"
                  type="number"
                  min={1}
                  value={consecutivoInicial}
                  onChange={(e) => setConsecutivoInicial(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={continuarLote} disabled={cargandoUltimoLote}>
                <ArrowRight className="h-3.5 w-3.5" /> Continuar lote
              </Button>
              <Button variant="ghost" size="sm" onClick={nuevoLote}>
                <RotateCcw className="h-3.5 w-3.5" /> Nuevo lote
              </Button>
            </div>

            {cargandoUltimoLote ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Buscando el último lote de &quot;{inicial}&quot;…</p>
            ) : ultimoLote ? (
              <div className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3 text-xs text-ink-soft dark:text-gray-400">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="font-medium text-ink dark:text-gray-100">
                    Último lote de &quot;{ultimoLote.inicial}&quot;: consecutivo {ultimoLote.primerConsecutivo} → {ultimoLote.ultimoConsecutivo} (
                    {ultimoLote.cantidad} etiquetas)
                  </p>
                  <p>
                    Generado el {fmtFechaCorta(ultimoLote.createdAt.slice(0, 10))} por {ultimoLote.generadoPor}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">Todavía no hay lotes generados para &quot;{inicial || '…'}&quot;.</p>
            )}

            <div>
              <Label htmlFor="observaciones">Observaciones (opcional)</Label>
              <textarea
                id="observaciones"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                placeholder="Ej: lote para el fin de semana"
              />
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-4">
              <p className="text-sm text-ink-soft dark:text-gray-400">
                Total: <span className="font-semibold text-ink dark:text-gray-100">{cantidadTotal}</span> etiqueta{cantidadTotal === 1 ? '' : 's'}
                {numDias > 1 && <span> ({numDias} días × {cantidadPorDia})</span>}
              </p>
              <Button onClick={generar} loading={generando} disabled={!inicial.trim() || cantidadTotal < 1}>
                <Wand2 className="h-4 w-4" /> Generar lote
              </Button>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
          </CardContent>
        </Card>

        {resultado && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Lote generado: {resultado.codigos.length} etiquetas
                </CardTitle>
                <Button onClick={descargarPdf} loading={descargando}>
                  <Download className="h-4 w-4" /> Descargar PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Vista previa de {Math.min(resultado.codigos.length, PREVIEW_LIMIT)} de {resultado.codigos.length} etiquetas
                {resultado.codigos.length > PREVIEW_LIMIT ? ' (la primera hoja)' : ''}.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {resultado.codigos.slice(0, PREVIEW_LIMIT).map((c) => (
                  <LabelPreview key={c.code} code={c.code} fecha={c.fecha} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Series activas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {series.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Todavía no hay series configuradas.</p>
            ) : (
              series.map((s) => (
                <div key={s.inicial} className="flex items-center justify-between text-sm">
                  <span className="font-mono font-semibold text-ink dark:text-gray-100">{s.inicial}</span>
                  <span className="text-right text-xs text-ink-soft dark:text-gray-400">
                    {s.descripcion} · último: {s.correlativo}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
