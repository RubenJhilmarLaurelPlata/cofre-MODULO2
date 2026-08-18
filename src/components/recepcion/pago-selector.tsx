'use client';

// src/components/recepcion/pago-selector.tsx
// Centro de operacion rapida de Recepcion: selector de condicion de pago.
// Fase 4B — rediseño de composicion (mismo contrato PagoForm de siempre,
// mismos conceptos: TARIFA acordada para este paquete puntual (pago.monto)
// y ESTADO pagado/por-pagar (pago.pagado)): antes eran hasta 8 botones
// altos apilados (PAGADO Bs2 / POR PAGAR Bs2 / PAGADO Bs3 / ...). Ahora son
// 2 pasos compactos: 1) Condicion (2 botones segmentados), 2) Monto (chips
// en una fila). El chip de monto seleccionado se resalta segun la
// condicion activa.
import * as React from 'react';
import { CheckCircle2, Clock3, Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PagoForm {
  pagado: boolean;
  monto: number;
}

interface PagoSelectorProps {
  moneda: string;
  montosRapidos: number[];
  pago: PagoForm;
  onPagoChange: (pago: PagoForm) => void;
}

export function PagoSelector({ moneda, montosRapidos, pago, onPagoChange }: PagoSelectorProps) {
  const [personalizarAbierto, setPersonalizarAbierto] = React.useState(false);
  const esPersonalizado = pago.monto > 0 && !montosRapidos.includes(pago.monto);

  return (
    <div className="space-y-2.5">
      {/* Paso 1: condicion */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onPagoChange({ ...pago, pagado: true })}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors',
            pago.pagado
              ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          )}
        >
          <CheckCircle2 className="h-4 w-4" /> Pagado
        </button>
        <button
          type="button"
          onClick={() => onPagoChange({ ...pago, pagado: false })}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors',
            !pago.pagado
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
              : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          )}
        >
          <Clock3 className="h-4 w-4" /> Por pagar
        </button>
      </div>

      {/* Paso 2: monto — chips compactos en una sola fila. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {montosRapidos.map((m) => {
          const seleccionado = pago.monto === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                onPagoChange({ ...pago, monto: m });
                setPersonalizarAbierto(false);
              }}
              className={cn(
                'rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition-colors',
                seleccionado
                  ? pago.pagado
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                  : 'border-gray-200 dark:border-gray-800 text-ink dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              )}
            >
              {moneda} {m}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setPersonalizarAbierto((v) => !v)}
          className={cn(
            'flex items-center gap-1 rounded-full border-2 border-dashed px-3.5 py-1.5 text-sm font-medium transition-colors',
            personalizarAbierto || esPersonalizado
              ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
              : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          )}
        >
          <Calculator className="h-3.5 w-3.5" />
          {esPersonalizado ? `${moneda} ${pago.monto}` : 'Otro'}
        </button>
      </div>

      {personalizarAbierto && (
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-2.5">
          <Input
            type="number"
            min={0}
            step="0.5"
            autoFocus
            value={esPersonalizado ? pago.monto : ''}
            onChange={(e) => onPagoChange({ ...pago, monto: Number(e.target.value) || 0 })}
            placeholder="Monto"
            className="h-9 max-w-[120px]"
          />
          <span className="text-xs text-ink-soft dark:text-gray-400">
            Se registrará como {pago.pagado ? 'pagado' : 'por pagar'}.
          </span>
        </div>
      )}
    </div>
  );
}
