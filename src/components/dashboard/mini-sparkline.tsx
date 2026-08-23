'use client';

// src/components/dashboard/mini-sparkline.tsx
// Mini grafico de area SIN ejes/tooltip/grid — para incrustar una
// tendencia real de 7 dias dentro de una StatTile compacta (Fase 5,
// Dashboard visual), igual criterio de "grafico real, no decorativo" que
// WeeklyChart: recibe exactamente los mismos numeros que ya se muestran
// como texto en la tarjeta, solo que tambien dibujados.
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export function MiniSparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  // Con un solo punto (o todos en cero) un area chart no dice nada util —
  // se omite en vez de dibujar una linea plana sin sentido.
  if (data.length < 2 || data.every((v) => v === 0)) return null;
  const formateado = data.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formateado} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
