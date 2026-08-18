// src/components/ui/status-badge.tsx
import type { PackageStatus } from '@/types';
import { Badge } from '@/components/ui/badge';

const ESTADOS: Record<PackageStatus, { label: string; variant: 'info' | 'warning' | 'brand' | 'success' | 'danger' }> = {
  EN_PAQUETERIA: { label: 'En Paquetería', variant: 'info' },
  EN_DEPOSITO: { label: 'En Depósito', variant: 'warning' },
  PENDIENTE_BAJAR: { label: 'Pendiente de bajar', variant: 'brand' },
  ENTREGADO: { label: 'Entregado', variant: 'success' },
  DENEGADO: { label: 'Denegado', variant: 'danger' },
};

/** Etiquetas legibles por estado, reutilizadas por el Buscador para su filtro de estado. */
export const ESTADO_LABELS: Record<PackageStatus, string> = Object.fromEntries(
  Object.entries(ESTADOS).map(([status, cfg]) => [status, cfg.label])
) as Record<PackageStatus, string>;

export function StatusBadge({ status }: { status: PackageStatus }) {
  // Fallback defensivo: como "status" ahora es un String en la base de
  // datos (SQLite no soporta enums), esto nunca deberia fallar en
  // condiciones normales, pero si llegara un valor inesperado, mostramos
  // el texto crudo en vez de romper la pagina.
  const cfg = ESTADOS[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
