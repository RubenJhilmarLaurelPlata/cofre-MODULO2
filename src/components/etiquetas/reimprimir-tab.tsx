'use client';

// src/components/etiquetas/reimprimir-tab.tsx
import * as React from 'react';
import { Search, Download, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LabelPreview } from '@/components/etiquetas/label-preview';
import type { LabelDescriptor } from '@/lib/etiquetas';

type Modo = 'codigo' | 'rango' | 'varios';

const PREVIEW_LIMIT = 30;

export function ReimprimirTab() {
  const [modo, setModo] = React.useState<Modo>('codigo');
  const [codigo, setCodigo] = React.useState('');
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');
  const [varios, setVarios] = React.useState('');

  const [buscando, setBuscando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<LabelDescriptor[] | null>(null);
  const [descargando, setDescargando] = React.useState(false);

  async function buscar() {
    setBuscando(true);
    setError(null);
    setResultado(null);
    try {
      let body: Record<string, unknown>;
      if (modo === 'codigo') {
        if (!codigo.trim()) {
          setError('Escribe un código.');
          setBuscando(false);
          return;
        }
        body = { tipo: 'codigos', codigos: [codigo.trim()] };
      } else if (modo === 'rango') {
        if (!desde.trim() || !hasta.trim()) {
          setError('Completa el código "desde" y "hasta".');
          setBuscando(false);
          return;
        }
        body = { tipo: 'rango', desde: desde.trim(), hasta: hasta.trim() };
      } else {
        const codigos = varios
          .split(/[\n,]/)
          .map((c) => c.trim())
          .filter(Boolean);
        if (codigos.length === 0) {
          setError('Escribe al menos un código.');
          setBuscando(false);
          return;
        }
        body = { tipo: 'codigos', codigos };
      }

      const res = await fetch('/api/etiquetas/reimprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se encontraron códigos.');
        return;
      }
      setResultado(data.codigos);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setBuscando(false);
    }
  }

  async function descargarPdf() {
    if (!resultado || descargando) return;
    setDescargando(true);
    try {
      const res = await fetch('/api/etiquetas/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: resultado }),
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
      a.download = 'etiquetas-reimpresion.pdf';
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
    { id: 'codigo', label: 'Código específico' },
    { id: 'rango', label: 'Rango de códigos' },
    { id: 'varios', label: 'Varios códigos' },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Reimprimir etiquetas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {MODOS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setModo(m.id);
                    setResultado(null);
                    setError(null);
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    modo === m.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700' : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {modo === 'codigo' && (
              <div className="max-w-xs">
                <Label htmlFor="codigo">Código</Label>
                <Input
                  id="codigo"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && buscar()}
                  placeholder="Ej: M24J-150"
                  className="mt-1 font-mono uppercase"
                />
              </div>
            )}

            {modo === 'rango' && (
              <div className="grid max-w-md grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="desde">Desde</Label>
                  <Input id="desde" value={desde} onChange={(e) => setDesde(e.target.value)} placeholder="M24J-150" className="mt-1 font-mono uppercase" />
                </div>
                <div>
                  <Label htmlFor="hasta">Hasta</Label>
                  <Input id="hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="M24J-180" className="mt-1 font-mono uppercase" />
                </div>
              </div>
            )}

            {modo === 'varios' && (
              <div>
                <Label htmlFor="varios">Códigos (uno por línea o separados por coma)</Label>
                <textarea
                  id="varios"
                  value={varios}
                  onChange={(e) => setVarios(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm font-mono uppercase text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  placeholder={'M24J-150\nM24J-162\nM24J-180'}
                />
              </div>
            )}

            <Button onClick={buscar} loading={buscando}>
              <Search className="h-4 w-4" /> Buscar
            </Button>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
          </CardContent>
        </Card>

        {resultado && resultado.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{resultado.length} código(s) encontrado(s)</CardTitle>
                <Button onClick={descargarPdf} loading={descargando}>
                  <Download className="h-4 w-4" /> Descargar PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Vista previa de {Math.min(resultado.length, PREVIEW_LIMIT)} de {resultado.length}
                {resultado.length > PREVIEW_LIMIT ? ' (la primera hoja)' : ''}.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {resultado.slice(0, PREVIEW_LIMIT).map((c) => (
                  <LabelPreview key={c.code} code={c.code} fecha={c.fecha} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
