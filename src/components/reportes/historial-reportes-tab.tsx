'use client';

// src/components/reportes/historial-reportes-tab.tsx
// Auditoria: quien exporto que reporte, cuando, con que filtros y en que formato.
import * as React from 'react';
import { FileText, FileSpreadsheet, FileType, User, Calendar, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HistorialReporteDTO, TipoReporte } from '@/lib/reportes';

const TITULOS_TIPO: Record<TipoReporte, string> = {
  PAQUETES: 'Paquetes',
  FINANCIERO: 'Financiero',
  OPERADORES: 'Operadores',
  DEPOSITO: 'Depósito',
  ETIQUETAS: 'Etiquetas',
};

const ICONOS_FORMATO = {
  PDF: FileType,
  EXCEL: FileSpreadsheet,
  CSV: FileText,
};

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

function describirFiltros(filtros: HistorialReporteDTO['filtros']): string {
  const partes: string[] = [`Modo: ${filtros.modo}`];
  if (filtros.estado) partes.push(`Estado: ${filtros.estado}`);
  if (filtros.inicial) partes.push(`Tipo: ${filtros.inicial}`);
  if (filtros.q) partes.push(`Búsqueda: "${filtros.q}"`);
  return partes.join(' · ');
}

export function HistorialReportesTab() {
  const [historial, setHistorial] = React.useState<HistorialReporteDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/reportes/historial')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'No se pudo cargar el historial.');
          return;
        }
        setHistorial(data);
      })
      .catch(() => setError('Error de conexión. Intenta de nuevo.'))
      .finally(() => setCargando(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de reportes generados</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {cargando ? (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando historial…</p>
        ) : historial.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se generó ningún reporte.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {historial.map((h) => {
              const IconoFormato = ICONOS_FORMATO[h.formato];
              return (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <IconoFormato className="h-4 w-4 shrink-0 text-brand-600" />
                    <div>
                      <p className="font-medium text-ink dark:text-gray-100">
                        {TITULOS_TIPO[h.tipo]} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({h.formato})</span>
                      </p>
                      <p className="text-xs text-ink-soft dark:text-gray-400">{describirFiltros(h.filtros)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {h.usuario}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {fmtFechaHora(h.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
