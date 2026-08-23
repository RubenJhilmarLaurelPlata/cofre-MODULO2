'use client';

// src/components/entrega/delivery-countdown.tsx
import * as React from 'react';
import { X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ESTADO_PAGO_LABEL: Record<string, string> = { PENDIENTE: 'Pendiente de pago', PARCIAL: 'Pago parcial', PAGADO: 'Pagado' };
const ESTADO_PAGO_VARIANT: Record<string, 'neutral' | 'warning' | 'success'> = { PENDIENTE: 'neutral', PARCIAL: 'warning', PAGADO: 'success' };

interface DeliveryCountdownProps {
  code: string;
  seconds?: number;
  // Monto y estado de pago: se muestran grandes durante la cuenta
  // regresiva (spec: "MONTO APARECE GRANDE" en el mismo momento en que
  // arranca el contador, no solo en la pantalla de fondo que este modal
  // cubre por completo).
  moneda: string;
  monto: number;
  estadoPago: string;
  // Tarifa acordada (Fase 3): distinta del monto a cobrar ahora — se
  // muestra chica arriba del total para que los tres conceptos
  // (tarifa/monto a cobrar/estado) convivan sin mezclarse, tal como
  // pide la especificación. Opcional: si no viene (o es igual al
  // monto), no se duplica la misma cifra dos veces.
  tarifaAcordada?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeliveryCountdown({ code, seconds = 5, moneda, monto, estadoPago, tarifaAcordada, onConfirm, onCancel }: DeliveryCountdownProps) {
  const [restante, setRestante] = React.useState(seconds);
  const onConfirmRef = React.useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  React.useEffect(() => {
    if (restante <= 0) {
      onConfirmRef.current();
      return;
    }
    const timer = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [restante]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="animate-scale-in w-full max-w-sm rounded-2xl border-t-4 border-t-rose-400 dark:border-t-rose-500 bg-white dark:bg-gray-900 p-8 text-center shadow-popover">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-gray-400">Entregando paquete</p>
        <p className="mt-2 break-all font-mono text-3xl font-bold text-ink dark:text-gray-100">{code}</p>

        <div className="mt-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
          {tarifaAcordada !== undefined && tarifaAcordada !== monto && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Tarifa acordada: {moneda} {tarifaAcordada.toFixed(2)}
            </p>
          )}
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Total a cobrar</p>
          <p className="text-4xl font-bold text-ink dark:text-gray-100">
            {moneda} {monto.toFixed(2)}
          </p>
          <div className="mt-2 flex justify-center">
            <Badge variant={ESTADO_PAGO_VARIANT[estadoPago] ?? 'neutral'}>{ESTADO_PAGO_LABEL[estadoPago] ?? estadoPago}</Badge>
          </div>
        </div>

        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-soft dark:text-gray-400">
          {restante > 0 ? 'Entrega automática en' : 'Entregando…'}
        </p>

        <div className="my-3 flex items-center justify-center">
          <div
            key={restante}
            className={cn(
              'animate-scale-in flex h-24 w-24 items-center justify-center rounded-full border-4 text-4xl font-bold',
              restante > 0 ? 'border-brand-500 text-brand-600' : 'border-rose-500 text-rose-600'
            )}
          >
            {restante > 0 ? restante : <Check className="h-10 w-10" strokeWidth={2.5} />}
          </div>
        </div>

        <p className="mb-6 text-sm text-ink-soft dark:text-gray-400">
          {restante > 0 ? `segundo${restante === 1 ? '' : 's'}` : 'Registrando la entrega…'}
        </p>

        <Button variant="secondary" className="w-full" onClick={onCancel} disabled={restante <= 0}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
      </div>
    </div>
  );
}
