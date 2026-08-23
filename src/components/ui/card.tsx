// src/components/ui/card.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-fade-in-up rounded-xl border border-gray-200 bg-white shadow-card transition-shadow duration-200 dark:border-gray-800 dark:bg-gray-900 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_20px_-10px_rgba(0,0,0,0.55)]',
        className
      )}
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

const STAT_TILE_TONES = {
  default: {
    wrap: '',
    chip: 'bg-gray-100 text-ink-soft dark:bg-gray-800 dark:text-gray-400',
    value: 'text-ink dark:text-gray-100',
  },
  brand: {
    wrap: 'border-brand-200 bg-brand-50 dark:border-brand-900/50 dark:bg-brand-500/10',
    chip: 'bg-brand-500 text-white',
    value: 'text-brand-700 dark:text-brand-400',
  },
  // "Entrada" — mismo verde usado en la identidad de Recepcion.
  success: {
    wrap: 'border-emerald-100 dark:border-emerald-900/40',
    chip: 'bg-emerald-500 text-white',
    value: 'text-ink dark:text-gray-100',
  },
  // "Salida" — mismo rojo/rosa usado en la identidad de Entrega.
  danger: {
    wrap: 'border-rose-100 dark:border-rose-900/40',
    chip: 'bg-rose-500 text-white',
    value: 'text-ink dark:text-gray-100',
  },
  info: {
    wrap: 'border-blue-100 dark:border-blue-900/40',
    chip: 'bg-blue-500 text-white',
    value: 'text-ink dark:text-gray-100',
  },
  warning: {
    wrap: 'border-amber-100 dark:border-amber-900/40',
    chip: 'bg-amber-500 text-white',
    value: 'text-ink dark:text-gray-100',
  },
} as const;

/** Metrica compacta: numero protagonista + etiqueta. Para grids densos (Dashboard mobile/tablet). El chip de icono cambia de color segun `tone` para dar lectura inmediata (verde=entrada, rojo=salida, ambar=deposito, azul=en paqueteria) sin depender solo del texto. */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'default',
  sub,
  chart,
  className,
  style,
}: {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  tone?: keyof typeof STAT_TILE_TONES;
  /** Linea pequena opcional debajo del valor (ej. variacion vs ayer, o un hint corto). */
  sub?: React.ReactNode;
  /** Mini-grafico opcional (ej. MiniSparkline) debajo de sub — solo para metricas con historial diario real, nunca decorativo. */
  chart?: React.ReactNode;
  className?: string;
  /** Para escalonar (stagger) la animacion de entrada en un grid — ej. style={{animationDelay: '80ms'}}. */
  style?: React.CSSProperties;
}) {
  const t = STAT_TILE_TONES[tone];
  return (
    <div
      style={style}
      className={cn(
        'animate-fade-in-up flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900',
        t.wrap,
        className
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium text-ink-soft dark:text-gray-400">{label}</span>
        {Icon && (
          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', t.chip)}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        )}
      </div>
      <span className={cn('text-xl font-bold leading-tight tracking-tight', t.value)}>{value}</span>
      {sub}
      {chart}
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
