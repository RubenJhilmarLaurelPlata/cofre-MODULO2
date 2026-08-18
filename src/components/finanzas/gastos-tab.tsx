'use client';

// src/components/finanzas/gastos-tab.tsx
import * as React from 'react';
import { Plus, Loader2, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { RangoFechaSelector, rangoFechaInicial, rangoFechaAQuery, type RangoFechaValue } from '@/components/finanzas/rango-fecha-selector';

interface Gasto {
  id: string;
  concepto: string;
  monto: number;
  fecha: string;
  observaciones: string | null;
  usuario: string;
}

function fmtFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

export function GastosTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [gastos, setGastos] = React.useState<Gasto[]>([]);
  const [cargando, setCargando] = React.useState(true);

  const [concepto, setConcepto] = React.useState('');
  const [monto, setMonto] = React.useState('');
  const [observaciones, setObservaciones] = React.useState('');
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cargar = React.useCallback(() => {
    setCargando(true);
    const qs = new URLSearchParams(rangoFechaAQuery(rango)).toString();
    fetch(`/api/finanzas/gastos?${qs}`)
      .then((r) => r.json())
      .then(setGastos)
      .finally(() => setCargando(false));
  }, [rango]);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function registrarGasto(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    const montoNum = Number(monto);
    if (!concepto.trim() || !montoNum || montoNum <= 0) {
      setError('Indica un concepto y un monto mayor a 0.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/finanzas/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concepto: concepto.trim(), monto: montoNum, observaciones: observaciones.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo registrar el gasto.');
        return;
      }
      setConcepto('');
      setMonto('');
      setObservaciones('');
      cargar();
    } finally {
      setGuardando(false);
    }
  }

  const total = gastos.reduce((acc, g) => acc + g.monto, 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <RangoFechaSelector value={rango} onChange={setRango} />
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Gastos registrados</CardTitle>
              <span className="text-sm font-semibold text-ink dark:text-gray-100">
                Total: {moneda} {total.toFixed(2)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {cargando ? (
              <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : gastos.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay gastos registrados en este período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800/60 text-left text-xs text-gray-400 dark:text-gray-500">
                      <th className="pb-2 font-medium">Fecha</th>
                      <th className="pb-2 font-medium">Concepto</th>
                      <th className="pb-2 font-medium">Registrado por</th>
                      <th className="pb-2 text-right font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {gastos.map((g) => (
                      <tr key={g.id}>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{fmtFecha(g.fecha)}</td>
                        <td className="py-2 text-ink dark:text-gray-100">
                          {g.concepto}
                          {g.observaciones && <p className="text-xs text-gray-400 dark:text-gray-500">{g.observaciones}</p>}
                        </td>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{g.usuario}</td>
                        <td className="py-2 text-right font-medium text-ink dark:text-gray-100">
                          {moneda} {g.monto.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Receipt className="h-4 w-4" /> Registrar gasto
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={registrarGasto} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="gasto-concepto">Concepto</Label>
              <Input id="gasto-concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Almuerzo, Transporte" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gasto-monto">Monto ({moneda})</Label>
              <Input id="gasto-monto" type="number" min={0} step="0.5" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gasto-obs">Observación (opcional)</Label>
              <Input id="gasto-obs" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Detalle adicional" />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <Button type="submit" className="w-full" loading={guardando}>
              <Plus className="h-4 w-4" /> Registrar gasto
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
