// src/components/ui/card.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-900 dark:shadow-none', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-ink dark:text-gray-100', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-ink-soft dark:text-gray-400', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

// --- Fase 4B: niveles de densidad adicionales ---------------------------
// Card/CardHeader/CardContent arriba quedan intactos (misma huella visual
// que ya usan ~60 pantallas). Estos tres son componentes NUEVOS para dar
// jerarquia real en vez de que todo use el mismo peso de "card grande":
// StatTile para metricas secundarias compactas, SectionBar para paneles
// tipo "lote activo" que no necesitan el chrome completo de una card.

/** Metrica compacta: numero protagonista + etiqueta, sin caja de icono. Para grids densos (Dashboard mobile/tablet). */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'default',
  sub,
  className,
}: {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  tone?: 'default' | 'brand';
  /** Linea pequena opcional debajo del valor (ej. variacion vs ayer, o un hint corto). */
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900',
        tone === 'brand' && 'border-brand-200 bg-brand-50 dark:border-brand-900/50 dark:bg-brand-500/10',
        className
      )}
    >
      <span className="flex items-center gap-1 text-[11px] font-medium text-ink-soft dark:text-gray-400">
        {Icon && <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />}
        {label}
      </span>
      <span className={cn('text-xl font-bold leading-tight tracking-tight', tone === 'brand' ? 'text-brand-700 dark:text-brand-400' : 'text-ink dark:text-gray-100')}>
        {value}
      </span>
      {sub}
    </div>
  );
}

/** Agrupador compacto sin chrome completo de card — para paneles tipo "lote activo" que deben integrarse en el flujo, no competir con el como otra tarjeta grande. */
export function SectionBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-100 bg-gray-50/60 px-3.5 py-3 dark:border-gray-800/60 dark:bg-gray-900/40',
        className
      )}
      {...props}
    />
  );
}
