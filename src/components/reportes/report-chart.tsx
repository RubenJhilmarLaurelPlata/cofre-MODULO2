'use client';

// src/components/reportes/report-chart.tsx
// Grafica generica reutilizada por los 5 reportes (paquetes/ingresos por
// dia, movimientos por operador, etc.), con la misma paleta y estilo que
// WeeklyChart del dashboard: naranja institucional, sin adornos.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useIsDark } from '@/lib/use-is-dark';
import type { PuntoSerie } from '@/lib/reportes';

function formatearEtiqueta(etiqueta: string): string {
  const partes = etiqueta.split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}`;
  return etiqueta;
}

export function ReportChart({ titulo, nombreValor, puntos }: { titulo: string; nombreValor: string; puntos: PuntoSerie[] }) {
  const isDark = useIsDark();

  if (puntos.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Sin datos para graficar en este período.</p>;
  }

  const data = puntos.map((p) => ({ ...p, etiqueta: formatearEtiqueta(p.etiqueta) }));
  const gridStroke = isDark ? '#27272A' : '#F1F2F4';
  const tickFill = isDark ? '#71717A' : '#9CA3AF';

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-ink-soft dark:text-gray-400">{titulo}</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={gridStroke} />
          <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: isDark ? '1px solid #27272A' : '1px solid #E5E7EB',
              boxShadow: '0 4px 10px rgba(15,17,21,0.08)',
              backgroundColor: isDark ? '#18181B' : '#FFFFFF',
            }}
            labelStyle={{ fontWeight: 600, color: isDark ? '#F4F4F5' : '#0F1115' }}
          />
          <Bar dataKey="valor" name={nombreValor} fill="#F2660F" radius={[3, 3, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
