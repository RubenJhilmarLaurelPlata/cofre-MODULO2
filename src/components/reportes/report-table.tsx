'use client';

// src/components/reportes/report-table.tsx
// Tabla generica reutilizada por los 5 reportes. Responsive: scroll
// horizontal propio en vez de desbordar la pagina.
import type { TablaReporte } from '@/lib/reportes';

export function ReportTable({ tabla }: { tabla: TablaReporte }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-ink-soft dark:text-gray-400">
        {tabla.titulo} ({tabla.filas.length})
      </p>
      <div className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800/60">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
              {tabla.columnas.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {tabla.filas.length === 0 ? (
              <tr>
                <td colSpan={tabla.columnas.length} className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  Sin datos para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              tabla.filas.map((fila, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  {tabla.columnas.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-2 text-ink dark:text-gray-100">
                      {fila[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
