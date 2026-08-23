'use client';

// src/components/finanzas/resumen-tab.tsx
import * as React from 'react';
import { TrendingUp, TrendingDown, Scale, Package as PackageIcon, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
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

interface PagoDetalle {
  id: string;
  codigo: string;
  tipo: string;
  monto: number;
  usuario: string;
  createdAt: string;
  motivo: string | null;
}

const TIPO_LABEL: Record<string, string> = {
  COBRO_ENTREGA: 'Cobro en entrega',
  ANTICIPO: 'Anticipo',
  AJUSTE: 'Ajuste',
};

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(iso)
  );
}

export function ResumenTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [resumen, setResumen] = React.useState<Resumen | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [detalleAbierto, setDetalleAbierto] = React.useState(false);
  const [pagos, setPagos] = React.useState<PagoDetalle[] | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = React.useState(false);

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

  // El desglose se pide aparte (no en cada render): son potencialmente
  // cientos de filas, y la mayoria de las veces el administrador solo
  // quiere ver los 4 totales, no la lista completa de movimientos.
  React.useEffect(() => {
    setPagos(null);
    setDetalleAbierto(false);
  }, [rango]);

  async function abrirDetalle() {
    const siguiente = !detalleAbierto;
    setDetalleAbierto(siguiente);
    if (siguiente && !pagos) {
      setCargandoDetalle(true);
      try {
        const qs = new URLSearchParams(rangoFechaAQuery(rango)).toString();
        const res = await fetch(`/api/finanzas/pagos?${qs}`);
        const data = await res.json();
        setPagos(res.ok ? data.pagos : []);
      } finally {
        setCargandoDetalle(false);
      }
    }
  }

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

          <Card>
            <button type="button" onClick={abrirDetalle} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="text-sm font-medium text-ink dark:text-gray-100">
                Ver de dónde sale cada {moneda} — desglose movimiento por movimiento
              </span>
              {detalleAbierto ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {detalleAbierto && (
              <CardContent className="pt-0">
                {cargandoDetalle ? (
                  <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : !pagos || pagos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                    No hay ningún movimiento de Pago en este período — el total de arriba es {moneda} 0.00 porque no hubo cobros reales.
                  </p>
                ) : (
                  <div className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800/60">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
                          <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Código</th>
                          <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Tipo</th>
                          <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Monto</th>
                          <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Fecha/hora</th>
                          <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Operador</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {pagos.map((p) => (
                          <tr key={p.id}>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink dark:text-gray-100">{p.codigo}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft dark:text-gray-400">{TIPO_LABEL[p.tipo] ?? p.tipo}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink dark:text-gray-100">
                              {moneda} {p.monto.toFixed(2)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{fmtFechaHora(p.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft dark:text-gray-400">{p.usuario}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 font-semibold">
                          <td className="px-3 py-2" colSpan={2}>
                            Total ({pagos.length} movimiento{pagos.length === 1 ? '' : 's'})
                          </td>
                          <td className="px-3 py-2 text-ink dark:text-gray-100">
                            {moneda} {pagos.reduce((acc, p) => acc + p.monto, 0).toFixed(2)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
