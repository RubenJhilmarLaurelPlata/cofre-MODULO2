'use client';

// src/components/dashboard/weekly-chart.tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useIsDark } from '@/lib/use-is-dark';

interface Punto {
  fecha: string;
  ingresados: number;
  entregados: number;
}

function formatearEtiqueta(fecha: string): string {
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

export function WeeklyChart({ data }: { data: Punto[] }) {
  const isDark = useIsDark();
  const formateado = data.map((d) => ({ ...d, etiqueta: formatearEtiqueta(d.fecha) }));
  const gridStroke = isDark ? '#27272A' : '#F1F2F4';
  const tickFill = isDark ? '#71717A' : '#9CA3AF';
  const entregadosColor = isDark ? '#F4F4F5' : '#0F1115';
  // Con periodos largos (Fase 4A: 90/365 dias) mostrar una etiqueta por
  // punto satura el eje — se muestran ~10 como maximo. En el caso
  // original de 7 dias esto sigue siendo 0 (una etiqueta por punto,
  // comportamiento identico al que ya existia).
  const tickInterval = Math.max(0, Math.floor(formateado.length / 10) - 1);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={formateado} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="ingresados" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F2660F" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#F2660F" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="entregados" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={entregadosColor} stopOpacity={0.1} />
            <stop offset="100%" stopColor={entregadosColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={gridStroke} />
        <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} interval={tickInterval} />
        <YAxis tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: isDark ? '1px solid #27272A' : '1px solid #E5E7EB',
            boxShadow: '0 4px 10px rgba(15,17,21,0.08)',
            backgroundColor: isDark ? '#18181B' : '#FFFFFF',
          }}
          labelStyle={{ fontWeight: 600, color: entregadosColor }}
        />
        <Area type="monotone" dataKey="ingresados" name="Ingresados" stroke="#F2660F" fill="url(#ingresados)" strokeWidth={2} />
        <Area type="monotone" dataKey="entregados" name="Entregados" stroke={entregadosColor} fill="url(#entregados)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
