'use client';

// src/components/finanzas/resumen-tab.tsx
import * as React from 'react';
import { TrendingUp, TrendingDown, Scale, Package as PackageIcon, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { RangoFechaSelector, rangoFechaInicial, rangoFechaAQuery, type RangoFechaValue } from '@/components/finanzas/rango-fecha-selector';

interface Resumen {
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
  etiqueta: string;
}

export function ResumenTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [resumen, setResumen] = React.useState<Resumen | null>(null);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    let cancelado = false;
    setCargando(true);
    const qs = new URLSearchParams(rangoFechaAQuery(rango)).toString();
    fetch(`/api/finanzas/resumen?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado) setResumen(data);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [rango]);

  return (
    <div className="space-y-5">
      <RangoFechaSelector value={rango} onChange={setRango} />

      {cargando || !resumen ? (
        <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500">{resumen.etiqueta}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-ink-soft dark:text-gray-400">Ingresos</p>
                  <p className="truncate text-xl font-semibold text-ink dark:text-gray-100">
                    {moneda} {resumen.ingresos.toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                  <TrendingDown className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-ink-soft dark:text-gray-400">Gastos</p>
                  <p className="truncate text-xl font-semibold text-ink dark:text-gray-100">
                    {moneda} {resumen.gastos.toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400">
                  <Scale className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-ink-soft dark:text-gray-400">Resultado neto</p>
                  <p className="truncate text-xl font-semibold text-ink dark:text-gray-100">
                    {moneda} {resumen.resultadoNeto.toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <PackageIcon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-ink-soft dark:text-gray-400">Paquetes cobrados</p>
                  <p className="truncate text-xl font-semibold text-ink dark:text-gray-100">{resumen.paquetesCobrados}</p>
                </div>
              </CardContent>
            </Card>
          </div>
          {resumen.ajustes !== 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Incluye {moneda} {resumen.ajustes.toFixed(2)} en ajustes registrados desde Finanzas en este período.
            </p>
          )}
        </>
      )}
    </div>
  );
}
