'use client';

// src/components/dashboard/chart-section.tsx
// Envuelve WeeklyChart (sin tocar su logica de render) con un selector de
// periodo real (Fase 4A): 7/30/90/365 dias o un rango personalizado. La
// carga inicial (7 dias) llega ya calculada del servidor — cambiar de
// periodo es lo unico que dispara un fetch nuevo, a
// /api/dashboard/grafico.
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { WeeklyChart } from '@/components/dashboard/weekly-chart';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Punto {
  fecha: string;
  ingresados: number;
  entregados: number;
}

const OPCIONES = [
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 365, label: '365 días' },
] as const;

export function ChartSection({ datosIniciales }: { datosIniciales: Punto[] }) {
  const [periodo, setPeriodo] = React.useState<number | 'personalizado'>(7);
  const [datos, setDatos] = React.useState<Punto[]>(datosIniciales);
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');

  async function cargar(params: URLSearchParams) {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/grafico?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cargar el periodo seleccionado.');
        return;
      }
      setDatos(data.serie);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  function elegirDias(dias: number) {
    setPeriodo(dias);
    if (dias === 7) {
      setDatos(datosIniciales); // ya lo trajo el servidor, no repetir el fetch
      return;
    }
    cargar(new URLSearchParams({ dias: String(dias) }));
  }

  function aplicarPersonalizado() {
    if (!desde || !hasta) return;
    setPeriodo('personalizado');
    cargar(new URLSearchParams({ desde, hasta }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {OPCIONES.map((o) => (
          <button
            key={o.dias}
            type="button"
            onClick={() => elegirDias(o.dias)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              periodo === o.dias
                ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            )}
          >
            {o.label}
          </button>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} className="h-8 w-[122px] text-xs sm:w-[130px]" />
          <span className="text-xs text-gray-400">–</span>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} className="h-8 w-[122px] text-xs sm:w-[130px]" />
          <button
            type="button"
            onClick={aplicarPersonalizado}
            disabled={!desde || !hasta}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
              periodo === 'personalizado'
                ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            )}
          >
            Personalizado
          </button>
        </div>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <WeeklyChart data={datos} />
    </div>
  );
}
