'use client';

// src/components/dashboard/estados-donut.tsx
// Donut de distribucion real de estados (Fase 5, Dashboard visual) — los
// mismos 5 conteos que ya se listan como texto en el Dashboard, ahora
// tambien como proporcion visual. Nunca inventa una categoria ni un
// numero: si no hay ningun paquete todavia, no se dibuja nada (evita un
// donut vacio sin sentido).
import * as React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useIsDark } from '@/lib/use-is-dark';

export interface SegmentoEstado {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function EstadosDonut({ segmentos, size = 132 }: { segmentos: SegmentoEstado[]; size?: number }) {
  const isDark = useIsDark();
  const total = segmentos.reduce((acc, s) => acc + s.value, 0);
  const conValor = segmentos.filter((s) => s.value > 0);

  if (total === 0) {
    return (
      <div style={{ width: size, height: size }} className="mx-auto flex items-center justify-center rounded-full border-4 border-dashed border-gray-200 dark:border-gray-700">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">Sin datos</span>
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size }} className="relative mx-auto">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={conValor}
            dataKey="value"
            nameKey="label"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={conValor.length > 1 ? 3 : 0}
            stroke={isDark ? '#18181B' : '#FFFFFF'}
            strokeWidth={2}
            isAnimationActive
          >
            {conValor.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold leading-none text-ink dark:text-gray-100">{total}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">paquetes</span>
      </div>
    </div>
  );
}
