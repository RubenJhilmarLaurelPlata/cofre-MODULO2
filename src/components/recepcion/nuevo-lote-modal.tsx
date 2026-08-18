'use client';

// src/components/recepcion/nuevo-lote-modal.tsx
// Fase 4B — "Nuevo lote" desde Recepcion (solo Admin): prefijo + serie +
// rango + monto + dias incluidos + nombre. Reutiliza integramente el motor
// ya existente de "Codigos personalizados" (POST /api/codigos-
// personalizados -> generarCodigosPersonalizados en src/lib/etiquetas.ts)
// — no se reimplementa la generacion de codigos, solo se le agrega una UI
// mas simple y enfocada a este flujo. Los codigos quedan listos para
// escanear de inmediato (recepcion/scan/route.ts ya sabe leer
// GeneratedCode.tarifaOverride/diasIncluidosOverride para cualquier
// codigo que coincida).
import * as React from 'react';
import { X, Layers, Loader2 } from 'lucide-react';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface NuevoLoteModalProps {
  moneda: string;
  separador: string;
  onClose: () => void;
  onCreado: () => void;
}

export function NuevoLoteModal({ moneda, separador, onClose, onCreado }: NuevoLoteModalProps) {
  const [prefijo, setPrefijo] = React.useState('');
  const [serie, setSerie] = React.useState('');
  const [desde, setDesde] = React.useState('1');
  const [hasta, setHasta] = React.useState('100');
  const [monto, setMonto] = React.useState('');
  const [dias, setDias] = React.useState('');
  const [nombre, setNombre] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const prefijoLimpio = prefijo.trim().toUpperCase().replace(/[^A-Z]/g, '');
  const serieLimpia = serie.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const desdeNum = Number(desde);
  const hastaNum = Number(hasta);
  const cantidad = Number.isFinite(desdeNum) && Number.isFinite(hastaNum) && hastaNum >= desdeNum ? hastaNum - desdeNum + 1 : 0;
  const valido = prefijoLimpio.length > 0 && serieLimpia.length > 0 && cantidad > 0 && cantidad <= 5000 && Number(monto) >= 0 && monto.trim() !== '';

  function construirCodigo(n: number): string {
    return `${prefijoLimpio}${serieLimpia}${separador}${n}`;
  }

  async function crear() {
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/codigos-personalizados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefijo: prefijoLimpio,
          serieNumero: serieLimpia,
          desde: desdeNum,
          hasta: hastaNum,
          monto: Number(monto),
          diasIncluidos: dias.trim() === '' ? undefined : Number(dias),
          nombre: nombre.trim() || undefined,
          descripcionNuevaSerie: nombre.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear el lote.');
        return;
      }
      onCreado();
      onClose();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800/60 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-gray-100">
            <Layers className="h-4 w-4" /> Nuevo lote
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lote-prefijo">Prefijo</Label>
              <Input id="lote-prefijo" value={prefijo} onChange={(e) => setPrefijo(e.target.value)} placeholder="Q" className="font-mono uppercase" maxLength={4} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lote-serie">Serie</Label>
              <Input id="lote-serie" value={serie} onChange={(e) => setSerie(e.target.value)} placeholder="16" className="font-mono uppercase" maxLength={10} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lote-desde">Desde</Label>
              <Input id="lote-desde" type="number" min={1} value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lote-hasta">Hasta</Label>
              <Input id="lote-hasta" type="number" min={1} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lote-monto">Monto ({moneda})</Label>
              <Input id="lote-monto" type="number" min={0} step="0.5" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="2" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lote-dias">Días incluidos</Label>
              <Input id="lote-dias" type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} placeholder="Usa el general" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="lote-nombre">Nombre</Label>
              <Input id="lote-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Fajas" maxLength={60} />
            </div>
          </div>

          {cantidad > 0 && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-ink-soft dark:text-gray-400">
                Vista previa · {cantidad} código{cantidad === 1 ? '' : 's'}
              </p>
              <p className="truncate font-mono text-sm text-ink dark:text-gray-100">
                {construirCodigo(desdeNum)}
                {cantidad > 1 && (
                  <>
                    {cantidad > 2 && ', …'}
                    {cantidad > 1 && `, ${construirCodigo(hastaNum)}`}
                  </>
                )}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800/60 px-5 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="button" onClick={crear} disabled={!valido || enviando}>
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear lote
          </Button>
        </div>
      </div>
    </div>
  );
}
