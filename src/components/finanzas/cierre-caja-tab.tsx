'use client';

// src/components/finanzas/cierre-caja-tab.tsx
// Ciclo real de caja: mientras existe una sesion sin cerrar, la caja esta
// ABIERTA — gastos/pagos nunca dependen de este estado (ver
// getEstadoCajaActual en src/lib/finanzas.ts), esto es solo la vista y la
// accion explicita de cerrar. "Cerrar caja" congela exactamente el
// periodo de la sesion actual (nunca un rango elegido a mano) y abre la
// siguiente sesion de inmediato.
import * as React from 'react';
import { Lock, LockOpen, Loader2, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface EstadoCaja {
  sesionId: string;
  abiertaAt: string;
  abiertaPor: string;
  resumen: { ingresos: number; gastos: number; ajustes: number; resultadoNeto: number; paquetesCobrados: number };
}

interface Cierre {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
  automatico: boolean;
  efectivoDeclarado: number | null;
  diferencia: number | null;
  estado: string;
  usuario: string;
  createdAt: string;
}

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function CierreCajaTab({ moneda }: { moneda: string }) {
  const [estado, setEstado] = React.useState<EstadoCaja | null>(null);
  const [cierres, setCierres] = React.useState<Cierre[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [efectivoDeclarado, setEfectivoDeclarado] = React.useState('');
  const [cerrando, setCerrando] = React.useState(false);
  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = React.useCallback(() => {
    setCargando(true);
    Promise.all([
      fetch('/api/finanzas/caja/estado').then((r) => r.json()),
      fetch('/api/finanzas/cierres').then((r) => r.json()),
    ])
      .then(([estadoData, cierresData]) => {
        setEstado(estadoData);
        setCierres(cierresData);
      })
      .finally(() => setCargando(false));
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function cerrarCaja() {
    if (cerrando) return;
    if (!window.confirm('¿Confirmas cerrar la caja? Se congela todo lo registrado desde que se abrió esta sesión y queda como historial permanente.')) return;
    setCerrando(true);
    setMensaje(null);
    try {
      const body: Record<string, unknown> = {};
      if (efectivoDeclarado.trim()) body.efectivoDeclarado = Number(efectivoDeclarado);
      const res = await fetch('/api/finanzas/caja/cerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ ok: false, texto: data.error ?? 'No se pudo cerrar la caja.' });
        return;
      }
      setMensaje({ ok: true, texto: 'Caja cerrada correctamente. Se abrió una nueva sesión.' });
      setEfectivoDeclarado('');
      cargar();
    } finally {
      setCerrando(false);
    }
  }

  if (cargando && !estado) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <LockOpen className="h-4 w-4 text-emerald-500" /> Caja abierta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {estado && (
            <>
              <p className="text-xs text-ink-soft dark:text-gray-400">
                Abierta desde <span className="font-medium text-ink dark:text-gray-100">{fmtFechaHora(estado.abiertaAt)}</span> por{' '}
                <span className="font-medium text-ink dark:text-gray-100">{estado.abiertaPor}</span>.
              </p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                  <p className="text-[11px] text-ink-soft dark:text-gray-400">Ingresos</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {moneda} {estado.resumen.ingresos.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                  <p className="text-[11px] text-ink-soft dark:text-gray-400">Gastos</p>
                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                    {moneda} {estado.resumen.gastos.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                  <p className="text-[11px] text-ink-soft dark:text-gray-400">Saldo esperado</p>
                  <p className="text-lg font-bold text-ink dark:text-gray-100">
                    {moneda} {estado.resumen.resultadoNeto.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                  <p className="text-[11px] text-ink-soft dark:text-gray-400">Paquetes cobrados</p>
                  <p className="text-lg font-bold text-ink dark:text-gray-100">{estado.resumen.paquetesCobrados}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 dark:border-gray-800/60 pt-4">
                <div className="space-y-1">
                  <Label htmlFor="efectivoDeclarado">Efectivo declarado (opcional)</Label>
                  <Input
                    id="efectivoDeclarado"
                    type="number"
                    min={0}
                    step="0.5"
                    value={efectivoDeclarado}
                    onChange={(e) => setEfectivoDeclarado(e.target.value)}
                    placeholder={`${moneda} 0.00`}
                    className="w-36"
                  />
                </div>
                <Button onClick={cerrarCaja} loading={cerrando}>
                  <Lock className="h-4 w-4" /> Cerrar caja
                </Button>
              </div>
              {mensaje && (
                <p className={mensaje.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-red-600 dark:text-red-400'}>{mensaje.texto}</p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Cerrar congela ingresos, gastos y resultado neto desde que se abrió esta sesión. Queda como historial permanente y no se puede modificar.
                Se abre una nueva sesión automáticamente al confirmar.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <History className="h-4 w-4" /> Cierres anteriores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cierres.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se realizó ningún cierre de caja.</p>
          ) : (
            <>
              {/* Móvil: tarjetas, mismo criterio ya usado en Importación
                  (ver importacion-client.tsx) para no comprimir una tabla
                  de 9 columnas hasta hacerla ilegible en pantallas chicas. */}
              <div className="space-y-2 md:hidden">
                {cierres.map((c) => (
                  <div key={c.id} className="rounded-lg border border-gray-100 dark:border-gray-800/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaHora(c.createdAt)}</span>
                      <Badge variant={c.automatico ? 'info' : 'neutral'}>{c.automatico ? 'Automático' : 'Manual'}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft dark:text-gray-400">
                      <span>
                        Ingresos: <span className="text-emerald-600 dark:text-emerald-400">{moneda} {c.ingresos.toFixed(2)}</span>
                      </span>
                      <span>
                        Gastos: <span className="text-red-600 dark:text-red-400">{moneda} {c.gastos.toFixed(2)}</span>
                      </span>
                      <span>
                        Neto: {moneda} {c.resultadoNeto.toFixed(2)}
                      </span>
                    </div>
                    {c.efectivoDeclarado !== null && (
                      <p className="mt-1 text-xs text-ink-soft dark:text-gray-400">
                        Declarado: {moneda} {c.efectivoDeclarado.toFixed(2)} · Diferencia:{' '}
                        <span className={c.diferencia && Math.abs(c.diferencia) > 0.009 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
                          {moneda} {(c.diferencia ?? 0).toFixed(2)}
                        </span>
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{c.usuario}</p>
                  </div>
                ))}
              </div>

              <div className="scrollbar-thin hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800/60 text-left text-xs text-gray-400 dark:text-gray-500">
                      <th className="pb-2 font-medium">Realizado</th>
                      <th className="pb-2 font-medium">Tipo</th>
                      <th className="pb-2 text-right font-medium">Ingresos</th>
                      <th className="pb-2 text-right font-medium">Gastos</th>
                      <th className="pb-2 text-right font-medium">Neto</th>
                      <th className="pb-2 text-right font-medium">Declarado</th>
                      <th className="pb-2 text-right font-medium">Diferencia</th>
                      <th className="pb-2 font-medium">Usuario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {cierres.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{fmtFechaHora(c.createdAt)}</td>
                        <td className="py-2">
                          <Badge variant={c.automatico ? 'info' : 'neutral'}>{c.automatico ? 'Automático' : 'Manual'}</Badge>
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
                        <td className="py-2 text-right text-ink-soft dark:text-gray-400">
                          {c.efectivoDeclarado !== null ? `${moneda} ${c.efectivoDeclarado.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 text-right text-ink-soft dark:text-gray-400">
                          {c.diferencia !== null ? `${moneda} ${c.diferencia.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{c.usuario}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
