'use client';

// src/components/finanzas/auditoria-tab.tsx
// Auditoría financiera por operador: quién recibió, quién entregó, quién
// cobró, quién corrigió — y la única inconsistencia detectable de verdad
// con los datos que existen: paquetes que ya figuran ENTREGADO en el
// período pero no tienen ningún Pago asociado (ver getAuditoriaFinanciera
// en src/lib/finanzas.ts para el porqué no se inventa ninguna otra).
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RangoFechaSelector, rangoFechaInicial, rangoFechaAQuery, type RangoFechaValue } from '@/components/finanzas/rango-fecha-selector';

interface AuditoriaOperador {
  userId: string | null;
  usuario: string;
  recepciones: number;
  entregas: number;
  cobros: number;
  montoCobrado: number;
  anticipos: number;
  montoAnticipos: number;
  ajustes: number;
  montoAjustes: number;
  entregasSinCobro: number;
}

interface Auditoria {
  ingresos: number;
  pagosRegistrados: number;
  paquetesEntregados: number;
  entregasSinCobro: number;
  codigosSinCobro: string[];
  porOperador: AuditoriaOperador[];
  etiqueta: string;
}

export function AuditoriaTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [datos, setDatos] = React.useState<Auditoria | null>(null);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    let cancelado = false;
    setCargando(true);
    const qs = new URLSearchParams(rangoFechaAQuery(rango)).toString();
    fetch(`/api/finanzas/auditoria?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado) setDatos(data);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [rango]);

  const hayInconsistencia = (datos?.entregasSinCobro ?? 0) > 0;

  return (
    <div className="space-y-5">
      <RangoFechaSelector value={rango} onChange={setRango} />

      {cargando || !datos ? (
        <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500">{datos.etiqueta}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-ink-soft dark:text-gray-400">Ingresos reales</p>
                <p className="text-lg font-semibold text-ink dark:text-gray-100">
                  {moneda} {datos.ingresos.toFixed(2)}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{datos.pagosRegistrados} pago(s) de tipo cobro en entrega</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-ink-soft dark:text-gray-400">Paquetes entregados</p>
                <p className="text-lg font-semibold text-ink dark:text-gray-100">{datos.paquetesEntregados}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-ink-soft dark:text-gray-400">Pagos registrados</p>
                <p className="text-lg font-semibold text-ink dark:text-gray-100">{datos.pagosRegistrados}</p>
              </CardContent>
            </Card>
            <Card className={hayInconsistencia ? 'border-amber-300 dark:border-amber-700' : undefined}>
              <CardContent className="flex items-start gap-2 py-4">
                {hayInconsistencia ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <div>
                  <p className="text-xs text-ink-soft dark:text-gray-400">Inconsistencias</p>
                  <p className={`text-lg font-semibold ${hayInconsistencia ? 'text-amber-700 dark:text-amber-400' : 'text-ink dark:text-gray-100'}`}>
                    {datos.entregasSinCobro}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {hayInconsistencia && (
            <Card className="border-amber-300 dark:border-amber-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" /> Entregados sin ningún cobro registrado
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-ink-soft dark:text-gray-400">
                  Estos {datos.entregasSinCobro} paquete(s) quedaron en estado Entregado en este período sin ningún movimiento de Pago (ni anticipo en
                  Recepción ni cobro en Entrega). Puede ser una entrega deliberadamente gratuita, o un cobro que el operador olvidó registrar — revísalos
                  desde Finanzas → Corregir cobro.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {datos.codigosSinCobro.map((c) => (
                    <span key={c} className="rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 font-mono text-xs text-amber-700 dark:text-amber-400">
                      {c}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Por operador</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {datos.porOperador.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay ninguna actividad registrada en este período.</p>
              ) : (
                <div className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800/60">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Operador</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Recibidos</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Entregados</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Cobros</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Anticipos</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Ajustes</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Sin cobro</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {datos.porOperador.map((o) => (
                        <tr key={o.userId ?? 'sistema'}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-ink dark:text-gray-100">{o.usuario}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">{o.recepciones}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">{o.entregas}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">
                            {o.cobros} · {moneda} {o.montoCobrado.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">
                            {o.anticipos} · {moneda} {o.montoAnticipos.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">
                            {o.ajustes} · {moneda} {o.montoAjustes.toFixed(2)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 font-semibold ${o.entregasSinCobro > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-ink-soft dark:text-gray-400'}`}>
                            {o.entregasSinCobro}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
