'use client';

// src/components/etiquetas/generar-pdf-tab.tsx
// Pantalla "Etiquetas -> Generar PDF" (Fase 5): el administrador arma una
// lista de series (M 200, S 200, Q 120...) con una unica fecha de
// ingreso, ve una vista previa fiel al PDF real, y al generar obtiene
// SIEMPRE un unico PDF con todas las series juntas, en el mismo orden en
// que las escribio. Reutiliza generarLote() en el servidor (una llamada
// por serie, mismo motor atomico de siempre) y el mismo endpoint
// /api/etiquetas/pdf que ya arma un PDF a partir de cualquier lista de
// codigos — aqui no se inventa un generador de PDF nuevo, solo se
// concatenan los codigos de todas las series antes de pedirlo.
import * as React from 'react';
import { FileText, Plus, Trash2, Download, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { EtiquetaPreviewCard } from '@/components/etiquetas/etiqueta-preview-card';
import { COLS, ROWS, ETIQUETAS_POR_HOJA, posicionEnHoja } from '@/lib/etiquetas-layout';
import type { LabelDescriptor } from '@/lib/etiquetas';
import type { SerieInfo } from '@/components/etiquetas/generar-tab';

interface GenerarPdfTabProps {
  series: SerieInfo[];
  monthLetters: Record<number, string>;
  separadorDefault: string;
  onCorrelativoActualizado: (inicial: string, nuevoCorrelativo: number) => void;
}

interface FilaSerie {
  id: string;
  inicial: string;
  cantidad: number;
}

// Una hoja completa (30), para que la vista previa muestre el mismo
// patron de columnas que el PDF real (1..10 en la columna 1, 11..20 en
// la columna 2, 21..30 en la columna 3) — con menos etiquetas no se
// alcanza a ver el patron completo.
const PREVIEW_LIMIT = ETIQUETAS_POR_HOJA;

function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFechaCorta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

let filaIdSeq = 0;
function nuevaFila(inicial = '', cantidad = 100): FilaSerie {
  filaIdSeq += 1;
  return { id: `fila-${filaIdSeq}`, inicial, cantidad };
}

export function GenerarPdfTab({ series, monthLetters, separadorDefault, onCorrelativoActualizado }: GenerarPdfTabProps) {
  const [fecha, setFecha] = React.useState(hoyStr());
  const [filas, setFilas] = React.useState<FilaSerie[]>([nuevaFila()]);
  const [generando, setGenerando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<{ resumen: string; total: number; nombreArchivo: string } | null>(null);

  const correlativoPorInicial = React.useMemo(() => new Map(series.map((s) => [s.inicial, s.correlativo])), [series]);

  const mes = Number(fecha.slice(5, 7)) || 0;
  const letraMes = monthLetters[mes];

  const filasValidas = filas.filter((f) => f.inicial.trim().length > 0 && f.cantidad > 0);
  const total = filasValidas.reduce((acc, f) => acc + f.cantidad, 0);

  // Vista previa: hasta una hoja completa (30) de etiquetas, calculadas
  // del lado del cliente con el mismo formato que construirCodigo() del
  // servidor, respetando el orden de las filas y el correlativo actual
  // de cada serie. Es solo una vista previa — la generacion real vuelve
  // a verificar todo contra la base de datos.
  const preview: LabelDescriptor[] = React.useMemo(() => {
    if (!letraMes) return [];
    const dia = fecha.slice(8, 10);
    const out: LabelDescriptor[] = [];
    for (const f of filasValidas) {
      if (out.length >= PREVIEW_LIMIT) break;
      const inicial = f.inicial.trim().toUpperCase();
      const consecutivoInicial = (correlativoPorInicial.get(inicial) ?? 0) + 1;
      const restante = PREVIEW_LIMIT - out.length;
      const cantidadPreview = Math.min(f.cantidad, restante);
      for (let i = 0; i < cantidadPreview; i++) {
        out.push({ code: `${inicial}${dia}${letraMes}${separadorDefault}${consecutivoInicial + i}`, fecha });
      }
    }
    return out;
  }, [filasValidas, fecha, letraMes, separadorDefault, correlativoPorInicial]);

  function agregarFila() {
    setFilas((prev) => [...prev, nuevaFila()]);
  }

  function quitarFila(id: string) {
    setFilas((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  }

  function actualizarFila(id: string, cambios: Partial<FilaSerie>) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  }

  async function generarPdf() {
    if (generando || filasValidas.length === 0) return;
    setGenerando(true);
    setError(null);
    setResultado(null);
    try {
      const body = {
        fecha,
        series: filasValidas.map((f) => ({ inicial: f.inicial.trim().toUpperCase(), cantidad: f.cantidad })),
      };
      const res = await fetch('/api/etiquetas/generar-pdf-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudieron generar las etiquetas.');
        return;
      }

      const codigosCombinados: LabelDescriptor[] = data.codigosCombinados;

      const resPdf = await fetch('/api/etiquetas/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: codigosCombinados }),
      });
      if (!resPdf.ok) {
        const errData = await resPdf.json().catch(() => null);
        setError(errData?.error ?? 'Las etiquetas se generaron, pero no se pudo armar el PDF.');
        return;
      }

      const blob = await resPdf.blob();
      const url = URL.createObjectURL(blob);
      const [y, m, d] = fecha.split('-');
      const nombreArchivo = `cofre-express-etiquetas-${d}-${m}-${y}.pdf`;
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      for (const s of data.series as Array<{ inicial: string; ultimoConsecutivo: number }>) {
        onCorrelativoActualizado(s.inicial, s.ultimoConsecutivo);
      }

      const resumen = (data.series as Array<{ inicial: string; codigos: LabelDescriptor[] }>)
        .map((s) => `${s.inicial}${s.codigos.length}`)
        .join(' + ');
      setResultado({ resumen: `${resumen} → ${data.total} etiquetas → 1 PDF`, total: data.total, nombreArchivo });
      setFilas([nuevaFila()]);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-brand-500" /> Fecha de ingreso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="max-w-xs" />
            {!letraMes && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> No hay una letra configurada para este mes. Configúrala arriba en &quot;Generar&quot; antes de continuar.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Series</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filas.map((f) => {
              const inicial = f.inicial.trim().toUpperCase();
              const serieExistente = series.find((s) => s.inicial === inicial);
              return (
                <div key={f.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 dark:border-gray-800 p-2.5">
                  <div className="w-24 min-w-0 flex-1 sm:flex-none">
                    <Label htmlFor={`inicial-${f.id}`}>Serie</Label>
                    <Input
                      id={`inicial-${f.id}`}
                      list="series-pdf-datalist"
                      value={f.inicial}
                      onChange={(e) => actualizarFila(f.id, { inicial: e.target.value.toUpperCase().slice(0, 4) })}
                      className="mt-1 font-mono uppercase"
                      placeholder="M, S, L, XL, Q…"
                    />
                  </div>
                  <div className="w-28 min-w-0 flex-1 sm:flex-none">
                    <Label htmlFor={`cantidad-${f.id}`}>Cantidad</Label>
                    <Input
                      id={`cantidad-${f.id}`}
                      type="number"
                      min={1}
                      max={5000}
                      value={f.cantidad}
                      onChange={(e) => actualizarFila(f.id, { cantidad: Math.max(1, Number(e.target.value) || 1) })}
                      className="mt-1 font-mono"
                    />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-xs text-ink-soft dark:text-gray-400">
                    {inicial ? (serieExistente ? `último: ${serieExistente.correlativo}` : 'serie nueva') : ''}
                  </p>
                  <Button variant="ghost" size="icon" onClick={() => quitarFila(f.id)} disabled={filas.length === 1} aria-label="Eliminar serie">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <datalist id="series-pdf-datalist">
              {series.map((s) => (
                <option key={s.inicial} value={s.inicial}>
                  {s.descripcion}
                </option>
              ))}
            </datalist>

            <Button variant="secondary" size="sm" onClick={agregarFila}>
              <Plus className="h-3.5 w-3.5" /> Agregar serie
            </Button>

            <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-4">
              <p className="text-sm text-ink-soft dark:text-gray-400">
                Total: <span className="font-semibold text-ink dark:text-gray-100">{total}</span> etiqueta{total === 1 ? '' : 's'}
              </p>
              <Button onClick={generarPdf} loading={generando} disabled={filasValidas.length === 0 || !letraMes}>
                <Download className="h-4 w-4" /> Generar PDF
              </Button>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            {resultado && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{resultado.resumen}</p>
                  <p className="text-xs opacity-80">{resultado.nombreArchivo}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Vista previa</CardTitle>
          </CardHeader>
          <CardContent>
            {preview.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Agrega al menos una serie con cantidad para ver la vista previa.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                  Vista previa — primeras {preview.length} etiquetas de {total}, en el mismo orden físico que el PDF (columna por columna). Fecha:{' '}
                  {fmtFechaCorta(fecha)}.
                </p>
                {/* Misma distribucion fisica que el PDF real: se usa la misma
                    funcion posicionEnHoja() (etiquetas-layout.ts) para ubicar
                    cada tarjeta, por eso la grilla tiene siempre 3 columnas
                    fijas (como una hoja) y se desplaza horizontalmente en
                    pantallas angostas en vez de re-acomodarse en 1 o 2
                    columnas — reacomodar cambiaria el orden visual. */}
                <div className="overflow-x-auto">
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${COLS}, minmax(150px, 1fr))`, gridTemplateRows: `repeat(${ROWS}, auto)`, minWidth: `${COLS * 150}px` }}
                  >
                    {preview.map((c, idx) => {
                      const { col, row } = posicionEnHoja(idx);
                      return (
                        <div key={c.code} style={{ gridColumn: col + 1, gridRow: row + 1 }}>
                          <EtiquetaPreviewCard code={c.code} fecha={c.fecha} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
