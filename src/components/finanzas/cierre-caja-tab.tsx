'use client';

// src/components/finanzas/cierre-caja-tab.tsx
import * as React from 'react';
import { Lock, Loader2, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RangoFechaSelector, rangoFechaInicial, rangoFechaAQuery, type RangoFechaValue } from '@/components/finanzas/rango-fecha-selector';

interface Cierre {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
  usuario: string;
  createdAt: string;
}

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function CierreCajaTab({ moneda }: { moneda: string }) {
  const [rango, setRango] = React.useState<RangoFechaValue>(rangoFechaInicial());
  const [cierres, setCierres] = React.useState<Cierre[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [realizando, setRealizando] = React.useState(false);
  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = React.useCallback(() => {
    setCargando(true);
    fetch('/api/finanzas/cierres')
      .then((r) => r.json())
      .then(setCierres)
      .finally(() => setCargando(false));
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function realizarCierre() {
    if (realizando) return;
    if (!window.confirm('¿Confirmas realizar el cierre de caja para el período seleccionado? Una vez creado, queda como registro histórico permanente.')) return;
    setRealizando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/finanzas/cierres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rangoFechaAQuery(rango)),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ ok: false, texto: data.error ?? 'No se pudo realizar el cierre.' });
        return;
      }
      setMensaje({ ok: true, texto: 'Cierre de caja registrado correctamente.' });
      cargar();
    } finally {
      setRealizando(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Lock className="h-4 w-4" /> Realizar cierre de caja
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <RangoFechaSelector value={rango} onChange={setRango} />
          {mensaje && (
            <p className={mensaje.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-red-600 dark:text-red-400'}>{mensaje.texto}</p>
          )}
          <Button onClick={realizarCierre} loading={realizando}>
            <Lock className="h-4 w-4" /> Realizar cierre de caja
          </Button>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            El cierre congela los ingresos, gastos y resultado neto del período elegido. Queda guardado como historial permanente y no se puede
            modificar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <History className="h-4 w-4" /> Cierres anteriores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cargando ? (
            <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : cierres.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se realizó ningún cierre de caja.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              {/* min-w evita que "w-full" achique las 7 columnas hasta
                  volverlas ilegibles en un telefono — sin esto, al no
                  haber contenido mas ancho que el contenedor,
                  overflow-x-auto nunca llegaba a activarse (mismo
                  criterio que auditoria-tab.tsx/report-table.tsx). */}
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800/60 text-left text-xs text-gray-400 dark:text-gray-500">
                    <th className="pb-2 font-medium">Realizado</th>
                    <th className="pb-2 font-medium">Período</th>
                    <th className="pb-2 text-right font-medium">Ingresos</th>
                    <th className="pb-2 text-right font-medium">Gastos</th>
                    <th className="pb-2 text-right font-medium">Neto</th>
                    <th className="pb-2 text-right font-medium">Paquetes</th>
                    <th className="pb-2 font-medium">Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {cierres.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 text-ink-soft dark:text-gray-400">{fmtFechaHora(c.createdAt)}</td>
                      <td className="py-2 text-ink dark:text-gray-100">
                        {fmtFechaHora(c.fechaInicio).split(' ')[0]} – {fmtFechaHora(c.fechaFin).split(' ')[0]}
                      </td>
                      <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">
                        {moneda} {c.ingresos.toFixed(2)}
                      </td>
                      <td className="py-2 text-right text-red-600 dark:text-red-400">
                        {moneda} {c.gastos.toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-medium text-ink dark:text-gray-100">
                        {moneda} {c.resultadoNeto.toFixed(2)}
                      </td>
                      <td className="py-2 text-right text-ink-soft dark:text-gray-400">{c.paquetesCobrados}</td>
                      <td className="py-2 text-ink-soft dark:text-gray-400">{c.usuario}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
