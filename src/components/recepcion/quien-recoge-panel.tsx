'use client';

// src/components/recepcion/quien-recoge-panel.tsx
// Panel opcional de Recepcion: "Datos de quien recoge el paquete" —
// distinto de quien lo DEJA (ver cliente-pago-panel.tsx). Todos los
// campos son opcionales y pueden completarse ahora o mas tarde, desde
// Entrega (ver EntregaClient, que edita los mismos campos del paquete:
// destinatario / destinatarioTelefono / destinatarioObservaciones).
import * as React from 'react';
import { ChevronDown, UserCheck, CheckCircle2 } from 'lucide-react';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CampoConVoz } from '@/components/recepcion/cliente-pago-panel';

export interface RecogeForm {
  nombre: string;
  telefono: string;
  observaciones: string;
}

interface QuienRecogePanelProps {
  recoge: RecogeForm;
  onRecogeChange: (recoge: RecogeForm) => void;
}

export function QuienRecogePanel({ recoge, onRecogeChange }: QuienRecogePanelProps) {
  const [abierto, setAbierto] = React.useState(false);
  const hayAlgo = Boolean(recoge.nombre || recoge.telefono || recoge.observaciones);

  function actualizar(campo: keyof RecogeForm, valor: string) {
    onRecogeChange({ ...recoge, [campo]: valor });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink dark:text-gray-100">
          <UserCheck className="h-4 w-4 shrink-0 text-ink-soft dark:text-gray-400" />
          <span>
            Datos de quien recoge <span className="font-normal text-xs text-gray-400 dark:text-gray-500">(opcional, se puede completar después)</span>
          </span>
          {hayAlgo && !abierto && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-400">
              <CheckCircle2 className="h-3 w-3" /> con datos
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 dark:border-gray-800/60 px-4 py-4 sm:grid-cols-2">
          <CampoConVoz id="recoge-nombre" label="Nombre" value={recoge.nombre} onChange={(v) => actualizar('nombre', v)} placeholder="Nombre de quien recogerá" />
          <div className="space-y-1">
            <Label htmlFor="recoge-telefono">Celular</Label>
            <Input id="recoge-telefono" value={recoge.telefono} onChange={(e) => actualizar('telefono', e.target.value)} placeholder="Celular de quien recogerá" />
          </div>
          <div className="sm:col-span-2">
            <CampoConVoz id="recoge-observaciones" label="Observaciones" value={recoge.observaciones} onChange={(v) => actualizar('observaciones', v)} placeholder="Ej: solo entregar con cédula" />
          </div>
        </div>
      )}
    </div>
  );
}
