'use client';

// src/components/recepcion/cliente-pago-panel.tsx
// Panel opcional de Recepcion: "Datos de quien deja el paquete" (cliente
// / emprendedor) + descripcion del contenido + foto. Todo opcional. Se
// mantiene colapsado por defecto para no interponerse en el flujo
// principal de "solo escanear" — el operador lo abre unicamente cuando
// quiere asociar estos datos al siguiente escaneo (o a varios seguidos,
// de la misma persona, en un lote). El pago vive aparte, ver
// src/components/recepcion/pago-selector.tsx — no se mezcla aqui.
import * as React from 'react';
import { ChevronDown, User2, Camera, ImagePlus, X, CheckCircle2 } from 'lucide-react';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { cn } from '@/lib/utils';

export interface ClienteForm {
  nombre: string;
  emprendimiento: string;
  telefono: string;
  observaciones: string;
}

interface ClientePagoPanelProps {
  clienteAsociadoId: string | null;
  cliente: ClienteForm;
  onClienteChange: (cliente: ClienteForm) => void;
  onLimpiarCliente: () => void;
  // A diferencia de "cliente" (compartido entre varios paquetes de la
  // misma persona), la foto y la descripción son propias de CADA
  // paquete: se limpian despues de cada registro exitoso.
  foto: string | null;
  onFotoChange: (foto: string | null) => void;
  descripcion: string;
  onDescripcionChange: (descripcion: string) => void;
}

export function CampoConVoz({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <VoiceInputButton onResult={(texto) => onChange(value ? `${value} ${texto}` : texto)} />
      </div>
    </div>
  );
}

export function ClientePagoPanel({
  clienteAsociadoId,
  cliente,
  onClienteChange,
  onLimpiarCliente,
  foto,
  onFotoChange,
  descripcion,
  onDescripcionChange,
}: ClientePagoPanelProps) {
  const [abierto, setAbierto] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const hayAlgo = Boolean(cliente.nombre || cliente.emprendimiento || cliente.telefono || cliente.observaciones || descripcion || foto);

  function actualizarCliente(campo: keyof ClienteForm, valor: string) {
    onClienteChange({ ...cliente, [campo]: valor });
  }

  function manejarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      window.alert('La foto debe ser PNG, JPG o WEBP.');
      return;
    }
    if (file.size > 3_000_000) {
      window.alert('La foto es demasiado grande (máximo ~3MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onFotoChange(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink dark:text-gray-100">
          <User2 className="h-4 w-4 shrink-0 text-ink-soft dark:text-gray-400" />
          <span>
            Datos de quien deja el paquete <span className="font-normal text-xs text-gray-400 dark:text-gray-500">(opcional)</span>
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
        <div className="space-y-5 border-t border-gray-100 dark:border-gray-800/60 px-4 py-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-ink-soft dark:text-gray-400">Cliente / emprendedor</p>
              {clienteAsociadoId && (
                <button type="button" onClick={onLimpiarCliente} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                  Empezar con otro cliente
                </button>
              )}
            </div>
            {clienteAsociadoId && (
              <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-400">
                Estos datos se asociarán automáticamente a los próximos paquetes que escanees, sin volver a escribirlos.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CampoConVoz id="cliente-nombre" label="Nombre" value={cliente.nombre} onChange={(v) => actualizarCliente('nombre', v)} placeholder="Nombre del cliente" />
              <CampoConVoz
                id="cliente-emprendimiento"
                label="Emprendimiento"
                value={cliente.emprendimiento}
                onChange={(v) => actualizarCliente('emprendimiento', v)}
                placeholder="Nombre del emprendimiento"
              />
              <div className="space-y-1">
                <Label htmlFor="cliente-telefono">Celular</Label>
                <Input
                  id="cliente-telefono"
                  value={cliente.telefono}
                  onChange={(e) => actualizarCliente('telefono', e.target.value)}
                  placeholder="Celular de contacto"
                />
              </div>
              <CampoConVoz id="paquete-descripcion" label="Descripción del paquete" value={descripcion} onChange={onDescripcionChange} placeholder="Ej: ropa, 2 cajas" />
              <div className="sm:col-span-2">
                <CampoConVoz
                  id="cliente-observaciones"
                  label="Observaciones generales"
                  value={cliente.observaciones}
                  onChange={(v) => actualizarCliente('observaciones', v)}
                  placeholder="Ej: cliente frecuente"
                />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Foto del paquete</p>
            {foto ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={foto} alt="Foto del paquete" className="h-20 w-20 rounded-lg object-cover ring-1 ring-gray-200 dark:ring-gray-700" />
                <div className="flex flex-col gap-1.5">
                  <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="h-3.5 w-3.5" /> Cambiar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onFotoChange(null)}>
                    <X className="h-3.5 w-3.5" /> Quitar
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                <Camera className="h-3.5 w-3.5" /> Tomar o elegir foto
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              onChange={manejarArchivo}
              className="hidden"
            />
          </div>
        </div>
      )}
    </div>
  );
}
