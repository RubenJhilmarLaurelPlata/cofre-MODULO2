// src/components/dashboard/recent-activity.tsx
import { StatusBadge } from '@/components/ui/status-badge';
import type { PackageStatus } from '@/types';

interface Actividad {
  code: string;
  estado: string;
  fecha: Date;
  usuario: string;
  montoPagado: number;
}

function formatearFechaHora(fecha: Date): string {
  return new Intl.DateTimeFormat('es-BO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(fecha);
}

export function RecentActivity({ items, moneda }: { items: Actividad[]; moneda: string }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Sin actividad reciente.</p>;
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
          <div className="flex items-center gap-2.5">
            <StatusBadge status={item.estado as PackageStatus} />
            <span className="font-mono text-sm font-medium text-ink dark:text-gray-100">{item.code}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">por {item.usuario}</span>
          </div>
          <div className="flex items-center gap-3">
            {item.montoPagado > 0 && (
              <span className="text-xs font-medium text-ink-soft dark:text-gray-400">
                {moneda} {item.montoPagado.toFixed(2)}
              </span>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500">{formatearFechaHora(item.fecha)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
