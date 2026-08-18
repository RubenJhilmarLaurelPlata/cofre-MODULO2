'use client';

// src/components/etiquetas/personalizados-tab.tsx
// Codigos personalizados (Paso B, excepcion administrativa): el
// administrador define prefijo + serie + rango + monto propio (ej.
// Q16-1..Q16-100 a Bs 5). Reutiliza el mismo motor y PDF que un lote de
// Etiquetas normal (ver src/lib/etiquetas.ts:generarCodigosPersonalizados),
// por eso conviven sin romper el sistema de series M/S/L/X.
import * as React from 'react';
import { Sparkles, Download, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { LabelPreview } from '@/components/etiquetas/label-preview';
import type { LabelDescriptor } from '@/lib/etiquetas';

const PREVIEW_LIMIT = 30;

export function PersonalizadosTab({ separadorDefault }: { separadorDefault: string }) {
  const [prefijo, setPrefijo] = React.useState('');
  const [serieNumero, setSerieNumero] = React.useState('');
  const [descripcionNueva, setDescripcionNueva] = React.useState('');
  const [desde, setDesde] = React.useState(1);
  const [hasta, setHasta] = React.useState(100);
  const [monto, setMonto] = React.useState(5);

  const [generando, setGenerando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<{ batchId: string; codigos: LabelDescriptor[] } | null>(null);
  const [descargando, setDescargando] = React.useState(false);

  const cantidad = Math.max(0, hasta - desde + 1);
  const ejemploCodigo = prefijo && serieNumero ? `${prefijo}${serieNumero}${separadorDefault}${desde}` : '';

  async function generar() {
    if (generando) return;
    setGenerando(true);
    setError(null);
    setResultado(null);
    try {
      const res = await fetch('/api/codigos-personalizados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefijo: prefijo.trim().toUpperCase(),
          serieNumero: serieNumero.trim().toUpperCase(),
          descripcionNuevaSerie: descripcionNueva || undefined,
          desde,
          hasta,
          monto,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudieron generar los códigos.');
        return;
      }
      setResultado({ batchId: data.batchId, codigos: data.codigos });
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
      a.download = `etiquetas-${resultado.codigos[0]?.code ?? 'personalizado'}.pdf`;
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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-500" /> Códigos personalizados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-ink-soft dark:text-gray-400">
              Excepción administrativa: crea un rango de códigos con su propio prefijo, serie y monto — sin necesidad de mes/día. Ej: Prefijo{' '}
              <span className="font-mono font-semibold">Q</span>, serie <span className="font-mono font-semibold">16</span>, desde 1 hasta 100, monto Bs
              5 → genera <span className="font-mono font-semibold">Q16-1</span> … <span className="font-mono font-semibold">Q16-100</span>.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="prefijo">Prefijo</Label>
                <Input
                  id="prefijo"
                  value={prefijo}
                  onChange={(e) => setPrefijo(e.target.value.toUpperCase().slice(0, 4))}
                  className="mt-1 font-mono uppercase"
                  placeholder="Q"
                />
              </div>
              <div>
                <Label htmlFor="serieNumero">Serie</Label>
                <Input
                  id="serieNumero"
                  value={serieNumero}
                  onChange={(e) => setSerieNumero(e.target.value.toUpperCase().slice(0, 10))}
                  className="mt-1 font-mono uppercase"
                  placeholder="16"
                />
              </div>
              <div>
                <Label htmlFor="desde">Desde</Label>
                <Input id="desde" type="number" min={1} value={desde} onChange={(e) => setDesde(Math.max(1, Number(e.target.value) || 1))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="hasta">Hasta</Label>
                <Input id="hasta" type="number" min={desde} value={hasta} onChange={(e) => setHasta(Math.max(desde, Number(e.target.value) || desde))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="monto">Monto (tarifa base de estos códigos)</Label>
                <Input id="monto" type="number" min={0} step="0.5" value={monto} onChange={(e) => setMonto(Math.max(0, Number(e.target.value) || 0))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="descripcionNueva">Descripción de la serie (opcional)</Label>
                <Input id="descripcionNueva" value={descripcionNueva} onChange={(e) => setDescripcionNueva(e.target.value)} className="mt-1" placeholder={`Serie ${prefijo || '…'}`} />
              </div>
            </div>

            {ejemploCodigo && (
              <p className="text-xs text-ink-soft dark:text-gray-400">
                Ejemplo del primer código: <span className="font-mono font-semibold text-ink dark:text-gray-100">{ejemploCodigo}</span>
              </p>
            )}

            <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-4">
              <p className="text-sm text-ink-soft dark:text-gray-400">
                Total: <span className="font-semibold text-ink dark:text-gray-100">{cantidad}</span> código{cantidad === 1 ? '' : 's'}
              </p>
              <Button onClick={generar} loading={generando} disabled={!prefijo.trim() || !serieNumero.trim() || cantidad < 1}>
                <Sparkles className="h-4 w-4" /> Generar
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
                  <CheckCircle2 className="h-4 w-4" /> {resultado.codigos.length} códigos generados
                </CardTitle>
                <Button onClick={descargarPdf} loading={descargando}>
                  <Download className="h-4 w-4" /> Descargar PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Vista previa de {Math.min(resultado.codigos.length, PREVIEW_LIMIT)} de {resultado.codigos.length}.
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
            <CardTitle>Cómo funciona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-ink-soft dark:text-gray-400">
            <p>Estos códigos quedan registrados como una serie más (igual que M, S, L, X) y aparecen en el Historial de lotes.</p>
            <p>Cada código puede tener Code 128 propio, o trabajarse manualmente si no se imprime la etiqueta.</p>
            <p>Al escanear uno en Recepción, se usa automáticamente el monto configurado aquí, sin afectar la tarifa general de la empresa.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
