'use client';

// src/components/reportes/report-view.tsx
// Vista generica de un reporte: la usan los 5 tipos (Paquetes, Financiero,
// Operadores, Deposito, Etiquetas), ya que todos comparten la misma forma
// (resumen + grafica + tablas) calculada en src/lib/reportes.ts.
import * as React from 'react';
import { Calendar, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/stat-card';
import { ReportChart } from '@/components/reportes/report-chart';
import { ReportTable } from '@/components/reportes/report-table';
import type { ReporteResultado } from '@/lib/reportes';

interface ReportViewProps {
  endpoint: string;
  queryString: string;
  icon: LucideIcon;
}

export function ReportView({ endpoint, queryString, icon }: ReportViewProps) {
  const [resultado, setResultado] = React.useState<ReporteResultado | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let activo = true;
    const t = setTimeout(() => {
      setCargando(true);
      setError(null);
      fetch(`${endpoint}?${queryString}`)
        .then(async (res) => {
          const data = await res.json();
          if (!activo) return;
          if (!res.ok) {
            setError(data.error ?? 'No se pudo cargar el reporte.');
            return;
          }
          setResultado(data);
        })
        .catch(() => {
          if (activo) setError('Error de conexión. Intenta de nuevo.');
        })
        .finally(() => {
          if (activo) setCargando(false);
        });
    }, 250);
    return () => {
      activo = false;
      clearTimeout(t);
    };
  }, [endpoint, queryString]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
        <XCircle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }

  if (cargando && !resultado) {
    return <p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">Cargando reporte…</p>;
  }

  if (!resultado) return null;

  const [periodo, ...resto] = resultado.resumen;

  return (
    <div className="space-y-5" data-report-content>
      {periodo && (
        <p className="flex items-center gap-1.5 text-sm text-ink-soft dark:text-gray-400">
          <Calendar className="h-4 w-4" /> {periodo.value}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {resto.map((item) => (
          <StatCard key={item.label} icon={icon} label={item.label} value={item.value} />
        ))}
      </div>

      {resultado.serie && (
        <Card>
          <CardContent>
            <ReportChart titulo={resultado.serie.titulo} nombreValor={resultado.serie.nombreValor} puntos={resultado.serie.puntos} />
          </CardContent>
        </Card>
      )}

      {resultado.tablas.map((tabla) => (
        <Card key={tabla.titulo}>
          <CardContent>
            <ReportTable tabla={tabla} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
