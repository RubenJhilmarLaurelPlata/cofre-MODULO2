'use client';

// src/components/finanzas/rango-fecha-selector.tsx
// Mismo selector de periodo (Hoy/Ayer/Semana/Mes/Rango) que usa Reportes,
// reutilizando los "modos" que ya resuelve resolverRangoFechas en el
// servidor (src/lib/reportes.ts) para no duplicar esa lógica de fechas.
import * as React from 'react';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ModoFechaReporte } from '@/lib/reportes';

export interface RangoFechaValue {
  modo: ModoFechaReporte;
  fechaInicio: string;
  fechaFin: string;
}

function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function rangoFechaInicial(): RangoFechaValue {
  return { modo: 'hoy', fechaInicio: hoyStr(), fechaFin: hoyStr() };
}

const MODOS: Array<{ id: ModoFechaReporte; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'rango', label: 'Rango' },
];

export function RangoFechaSelector({ value, onChange }: { value: RangoFechaValue; onChange: (v: RangoFechaValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange({ ...value, modo: m.id })}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              value.modo === m.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {value.modo === 'rango' && (
        <div className="flex items-center gap-2">
          <div className="space-y-1">
            <Label htmlFor="rango-desde">Desde</Label>
            <Input id="rango-desde" type="date" value={value.fechaInicio} onChange={(e) => onChange({ ...value, fechaInicio: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rango-hasta">Hasta</Label>
            <Input id="rango-hasta" type="date" value={value.fechaFin} onChange={(e) => onChange({ ...value, fechaFin: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function rangoFechaAQuery(v: RangoFechaValue): Record<string, string> {
  const payload: Record<string, string> = { modo: v.modo };
  if (v.modo === 'rango') {
    payload.fechaInicio = v.fechaInicio;
    payload.fechaFin = v.fechaFin;
  }
  return payload;
}
