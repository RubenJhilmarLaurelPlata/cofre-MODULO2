'use client';

// src/components/finanzas/auditoria-tab.tsx
// Auditoría financiera por operador: quién recibió, quién entregó (normal/
// excepcional/vía importación), quién cobró, quién corrigió — más una
// reconciliación explícita de "paquetes cobrados" vs "entregados" y la
// detección de inconsistencias reales (paquetes ENTREGADO sin ningún Pago,
// y posibles pagos duplicados) — ver getAuditoriaFinanciera/
// getReconciliacion en src/lib/finanzas.ts para el porqué de cada cálculo.
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RangoFechaSelector, rangoFechaInicial, rangoFechaAQuery, type RangoFechaValue } from '@/components/finanzas/rango-fecha-selector';

interface AuditoriaOperador {
  userId: string | null;
  usuario: string;
  recepciones: number;
  entregas: number;
  entregasNormales: number;
  entregasExcepcionales: number;
  entregasImportacion: number;
  cobros: number;
  montoCobrado: number;
  anticipos: number;
  montoAnticipos: number;
  ajustes: number;
  montoAjustes: number;
  entregasSinCobro: number;
  cobrosSinEntrega: number;
}

interface PagoDuplicado {
  codigo: string;
  tipo: string;
  monto: number;
  primeraFecha: string;
  segundaFecha: string;
  segundosEntre: number;
  usuario: string;
}

interface Auditoria {
  ingresos: number;
  pagosRegistrados: number;
  paquetesEntregados: number;
  entregasSinCobro: number;
  codigosSinCobro: string[];
  posiblesDuplicados: PagoDuplicado[];
  porOperador: AuditoriaOperador[];
  etiqueta: string;
}

interface Reconciliacion {
  entregas: { normales: number; excepcionales: number; importacion: number; total: number };
  cobros: {
    cobrosEntrega: number;
    montoCobrosEntrega: number;
    anticipos: number;
    montoAnticipos: number;
    ajustes: number;
    montoAjustes: number;
    totalPaquetesCobrados: number;
    montoTotal: number;
  };
  diferencia: { cobrosAsociadosAEntrega: number; cobrosSinEntrega: number; anticipos: number; ajustes: number };
}

export function AuditoriaTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [datos, setDatos] = React.useState<Auditoria | null>(null);
  const [reconciliacion, setReconciliacion] = React.useState<Reconciliacion | null>(null);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    let cancelado = false;
    setCargando(true);
    const qs = new URLSearchParams(rangoFechaAQuery(rango)).toString();
    Promise.all([
      fetch(`/api/finanzas/auditoria?${qs}`).then((r) => r.json()),
      fetch(`/api/finanzas/reconciliacion?${qs}`).then((r) => r.json()),
    ])
      .then(([auditoria, recon]) => {
        if (cancelado) return;
        setDatos(auditoria);
        setReconciliacion(recon);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [rango]);

  const hayInconsistencia = (datos?.entregasSinCobro ?? 0) > 0;
  const hayDuplicados = (datos?.posiblesDuplicados.length ?? 0) > 0;
  const totalInconsistencias = (datos?.entregasSinCobro ?? 0) + (datos?.posiblesDuplicados.length ?? 0);

  return (
    <div className="space-y-5">
      <RangoFechaSelector value={rango} onChange={setRango} />

      {cargando || !datos || !reconciliacion ? (
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
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-ink-soft dark:text-gray-400">Total entregas</p>
                <p className="text-lg font-semibold text-ink dark:text-gray-100">{datos.paquetesEntregados}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-ink-soft dark:text-gray-400">Paquetes cobrados</p>
                <p className="text-lg font-semibold text-ink dark:text-gray-100">{reconciliacion.cobros.totalPaquetesCobrados}</p>
              </CardContent>
            </Card>
            <Card className={totalInconsistencias > 0 ? 'border-amber-300 dark:border-amber-700' : undefined}>
              <CardContent className="flex items-start gap-2 py-4">
                {totalInconsistencias > 0 ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <div>
                  <p className="text-xs text-ink-soft dark:text-gray-400">Inconsistencias</p>
                  <p className={`text-lg font-semibold ${totalInconsistencias > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-ink dark:text-gray-100'}`}>
                    {totalInconsistencias}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Reconciliación de entregas y cobros</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Entregas</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Entregas normales</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">{reconciliacion.entregas.normales}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Entregas excepcionales</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">{reconciliacion.entregas.excepcionales}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Entregas vía importación</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">{reconciliacion.entregas.importacion}</dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-1.5 font-semibold">
                    <dt className="text-ink dark:text-gray-100">Total entregas</dt>
                    <dd className="text-ink dark:text-gray-100">{reconciliacion.entregas.total}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Cobros</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Cobros de entrega</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">
                      {reconciliacion.cobros.cobrosEntrega} · {moneda} {reconciliacion.cobros.montoCobrosEntrega.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Anticipos</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">
                      {reconciliacion.cobros.anticipos} · {moneda} {reconciliacion.cobros.montoAnticipos.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Ajustes</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">
                      {reconciliacion.cobros.ajustes} · {moneda} {reconciliacion.cobros.montoAjustes.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-1.5 font-semibold">
                    <dt className="text-ink dark:text-gray-100">Total paquetes cobrados</dt>
                    <dd className="text-ink dark:text-gray-100">
                      {reconciliacion.cobros.totalPaquetesCobrados} · {moneda} {reconciliacion.cobros.montoTotal.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Diferencia</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Cobros asociados a una entrega</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">{reconciliacion.diferencia.cobrosAsociadosAEntrega}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">Cobros sin entrega en este período</dt>
                    <dd className="font-medium text-ink dark:text-gray-100">{reconciliacion.diferencia.cobrosSinEntrega}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">— de los cuales anticipos</dt>
                    <dd className="text-ink-soft dark:text-gray-400">{reconciliacion.diferencia.anticipos}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-soft dark:text-gray-400">— de los cuales ajustes</dt>
                    <dd className="text-ink-soft dark:text-gray-400">{reconciliacion.diferencia.ajustes}</dd>
                  </div>
                </dl>
                {reconciliacion.diferencia.cobrosSinEntrega > 0 && (
                  <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                    Estos {reconciliacion.diferencia.cobrosSinEntrega} cobro(s) son anticipos o ajustes cuyo paquete no tiene una entrega registrada en
                    este mismo período — la entrega ocurrió otro día, o el paquete todavía no fue entregado. Esto explica por qué &ldquo;paquetes
                    cobrados&rdquo; puede ser mayor que &ldquo;entregados&rdquo;: no es un error, son categorías distintas.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

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

          {hayDuplicados && (
            <Card className="border-amber-300 dark:border-amber-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" /> Posibles pagos duplicados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-ink-soft dark:text-gray-400">
                  Mismo paquete, mismo tipo y mismo monto, registrados con menos de 15 segundos de diferencia — revisa si fue un envío repetido por error.
                </p>
                <div className="scrollbar-thin overflow-x-auto rounded-lg border border-amber-200 dark:border-amber-800">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead>
                      <tr className="bg-amber-50 dark:bg-amber-500/10">
                        <th className="px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Código</th>
                        <th className="px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Tipo</th>
                        <th className="px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Monto</th>
                        <th className="px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Segundos entre</th>
                        <th className="px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Operador</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100 dark:divide-amber-900/40">
                      {datos.posiblesDuplicados.map((d, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink dark:text-gray-100">{d.codigo}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft dark:text-gray-400">{d.tipo}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink dark:text-gray-100">
                            {moneda} {d.monto.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{d.segundosEntre}s</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft dark:text-gray-400">{d.usuario}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Operador</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Recibidos</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Entregas (normal/excep./imp.)</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Cobros</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Anticipos</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Ajustes</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Sin cobro</th>
                        <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Cobros sin entrega</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {datos.porOperador.map((o) => (
                        <tr key={o.userId ?? 'sistema'}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-ink dark:text-gray-100">{o.usuario}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">{o.recepciones}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">
                            {o.entregas} ({o.entregasNormales}/{o.entregasExcepcionales}/{o.entregasImportacion})
                          </td>
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
                          <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">{o.cobrosSinEntrega}</td>
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
