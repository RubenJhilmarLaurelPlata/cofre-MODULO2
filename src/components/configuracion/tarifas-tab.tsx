'use client';

// src/components/configuracion/tarifas-tab.tsx
// Estos campos son los que ya lee pricing.ts (calcularCosto) en todo el
// sistema: cualquier cambio se aplica de inmediato a los proximos
// calculos, sin tocar esa logica.
import * as React from 'react';
import { Save, CheckCircle2, XCircle, Info, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function TarifasTab() {
  const [tarifaBase, setTarifaBase] = React.useState(0);
  const [diasIncluidos, setDiasIncluidos] = React.useState(0);
  const [costoAdicionalDia, setCostoAdicionalDia] = React.useState(0);
  const [montosPagoRapido, setMontosPagoRapido] = React.useState('2,3,5,7');
  const [entregaCountdownSegundos, setEntregaCountdownSegundos] = React.useState(5);
  const [cierreAutomaticoHabilitado, setCierreAutomaticoHabilitado] = React.useState(false);
  const [horaCierreAutomatico, setHoraCierreAutomatico] = React.useState('20:00');
  const [cargando, setCargando] = React.useState(true);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/tarifas')
      .then((res) => res.json())
      .then((data) => {
        setTarifaBase(data.tarifaBase);
        setDiasIncluidos(data.diasIncluidos);
        setCostoAdicionalDia(data.costoAdicionalDia);
        setMontosPagoRapido(data.montosPagoRapido ?? '2,3,5,7');
        setEntregaCountdownSegundos(data.entregaCountdownSegundos ?? 5);
        setCierreAutomaticoHabilitado(data.cierreAutomaticoHabilitado ?? false);
        setHoraCierreAutomatico(data.horaCierreAutomatico ?? '20:00');
      })
      .finally(() => setCargando(false));
  }, []);

  async function guardar() {
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/tarifas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tarifaBase,
          diasIncluidos,
          costoAdicionalDia,
          montosPagoRapido,
          entregaCountdownSegundos,
          cierreAutomaticoHabilitado,
          horaCierreAutomatico,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setFeedback({ ok: true, mensaje: 'Tarifas actualizadas. Se aplicarán a los cálculos nuevos de inmediato.' });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarifas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="tarifaBase">Tarifa base</Label>
            <Input id="tarifaBase" type="number" min={0} step={0.5} value={tarifaBase} onChange={(e) => setTarifaBase(Number(e.target.value))} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="diasIncluidos">Días incluidos</Label>
            <Input
              id="diasIncluidos"
              type="number"
              min={0}
              value={diasIncluidos}
              onChange={(e) => setDiasIncluidos(Number(e.target.value))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="costoAdicionalDia">Costo diario adicional</Label>
            <Input
              id="costoAdicionalDia"
              type="number"
              min={0}
              step={0.5}
              value={costoAdicionalDia}
              onChange={(e) => setCostoAdicionalDia(Number(e.target.value))}
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3 text-xs text-ink-soft dark:text-gray-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            El &quot;cobro especial&quot; por tipo de paquete se configura en la pestaña <strong>Tipos de código</strong> (campo &quot;tarifa especial&quot;),
            ya que ese valor reemplaza la tarifa base solo para ese tipo puntual.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-gray-100 dark:border-gray-800/60 pt-5">
          <div>
            <Label htmlFor="montosPagoRapido">Montos rápidos de pago en Recepción</Label>
            <Input
              id="montosPagoRapido"
              value={montosPagoRapido}
              onChange={(e) => setMontosPagoRapido(e.target.value)}
              className="mt-1"
              placeholder="2,3,5,7"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Separados por comas. Aparecen como botones en Recepción, en este orden.</p>
          </div>
          <div>
            <Label htmlFor="entregaCountdown">Segundos de cuenta regresiva en Entrega</Label>
            <Input
              id="entregaCountdown"
              type="number"
              min={1}
              max={30}
              value={entregaCountdownSegundos}
              onChange={(e) => setEntregaCountdownSegundos(Number(e.target.value))}
              className="mt-1"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800/60 pt-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-gray-100">
            <Lock className="h-3.5 w-3.5" /> Cierre automático de caja
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-gray-100">
              <input
                type="checkbox"
                checked={cierreAutomaticoHabilitado}
                onChange={(e) => setCierreAutomaticoHabilitado(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              Cierre automático {cierreAutomaticoHabilitado ? 'activado' : 'desactivado'}
            </label>
            <div className={cn('space-y-1', !cierreAutomaticoHabilitado && 'opacity-50')}>
              <Label htmlFor="horaCierre">Hora de cierre</Label>
              <Input
                id="horaCierre"
                type="time"
                value={horaCierreAutomatico}
                onChange={(e) => setHoraCierreAutomatico(e.target.value)}
                disabled={!cierreAutomaticoHabilitado}
                className="w-32"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            Si está activado, la caja se cierra sola apenas pasa esta hora (queda identificada como &quot;Cierre automático&quot; en el historial de
            Finanzas → Cierre de caja, nunca como si la hubiera cerrado una persona). Si está desactivado, nunca se cierra sola.
          </p>
        </div>

        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              feedback.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
          >
            {feedback.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {feedback.mensaje}
          </div>
        )}

        <Button onClick={guardar} loading={guardando}>
          <Save className="h-4 w-4" /> Guardar cambios
        </Button>
      </CardContent>
    </Card>
  );
}
