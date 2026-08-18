// src/components/dashboard/stat-card.tsx
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Variacion } from '@/lib/dashboard-comparacion';

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = false,
  variacion,
  variacionLabel = 'vs ayer',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  /** Comparación real vs. el periodo anterior (Fase 4A) — null muestra "Sin datos suficientes" en vez de inventar un porcentaje. Omitir la prop si esta tarjeta no tiene comparación (ej. "En Paquetería"). */
  variacion?: Variacion | null;
  /** Texto tras el porcentaje, ej. "vs ayer" (por defecto) o "vs mes anterior". */
  variacionLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl',
            accent ? 'bg-brand-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-ink-soft dark:text-gray-400'
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-xs font-medium text-ink-soft dark:text-gray-400">{label}</p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-ink dark:text-gray-100">{value}</p>
          {variacion !== undefined ? (
            <p
              className={cn(
                'mt-0.5 flex items-center gap-1 text-xs font-medium',
                variacion === null ? 'text-gray-400 dark:text-gray-500' : variacion.positiva ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              )}
            >
              {variacion === null ? (
                'Sin datos suficientes'
              ) : (
                <>
                  {variacion.positiva ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {variacion.texto} {variacionLabel}
                </>
              )}
            </p>
          ) : (
            hint && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{hint}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
