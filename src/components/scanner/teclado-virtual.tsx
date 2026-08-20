'use client';

// src/components/scanner/teclado-virtual.tsx
// Teclado en pantalla para escribir codigos sin depender del teclado
// virtual de Android — util cuando el lector KNUP KP-1018A (HID) esta
// conectado y el sistema operativo oculta el teclado nativo. Mismo
// contrato que CameraScanner (onDetect: (code: string) => void): este
// componente NO normaliza nada por su cuenta, solo junta lo que el
// operador toca en un string crudo — la normalizacion sigue pasando
// exclusivamente por normalizarEntradaEscaneo() en el escanear()/
// registrar() de cada pantalla, exactamente igual que USB y Camara. Cero
// logica duplicada.
import * as React from 'react';
import { Delete, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FILA_LETRAS_1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
const FILA_LETRAS_2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
const FILA_LETRAS_3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
const FILA_NUMEROS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function Tecla({ children, onClick, className, ariaLabel }: { children: React.ReactNode; onClick: () => void; className?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'flex h-9 min-w-[1.75rem] flex-1 items-center justify-center rounded-md bg-white dark:bg-gray-800 text-xs font-semibold text-ink dark:text-gray-100 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700 active:bg-gray-100 dark:active:bg-gray-700',
        className
      )}
    >
      {children}
    </button>
  );
}

export function TecladoVirtual({ onDetect }: { onDetect: (code: string) => void }) {
  const [valor, setValor] = React.useState('');

  function agregar(c: string) {
    setValor((v) => (v + c).slice(0, 40));
  }

  function confirmar() {
    if (!valor.trim()) return;
    onDetect(valor);
    setValor('');
  }

  return (
    <div className="space-y-2.5">
      <div className="flex h-11 items-center justify-between rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-3">
        <span className="truncate font-mono text-base font-semibold text-ink dark:text-gray-100">{valor || ' '}</span>
        {valor && (
          <button type="button" onClick={() => setValor('')} aria-label="Borrar todo" className="shrink-0 text-gray-400 hover:text-red-500">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-1">
          {FILA_NUMEROS.map((n) => (
            <Tecla key={n} onClick={() => agregar(n)}>
              {n}
            </Tecla>
          ))}
        </div>
        <div className="flex gap-1">
          {FILA_LETRAS_1.map((l) => (
            <Tecla key={l} onClick={() => agregar(l)}>
              {l}
            </Tecla>
          ))}
        </div>
        <div className="flex gap-1 px-2">
          {FILA_LETRAS_2.map((l) => (
            <Tecla key={l} onClick={() => agregar(l)}>
              {l}
            </Tecla>
          ))}
        </div>
        <div className="flex gap-1">
          {FILA_LETRAS_3.map((l) => (
            <Tecla key={l} onClick={() => agregar(l)}>
              {l}
            </Tecla>
          ))}
          <Tecla onClick={() => agregar('-')} className="flex-[1.4] text-brand-600 dark:text-brand-400">
            -
          </Tecla>
          <Tecla onClick={() => setValor((v) => v.slice(0, -1))} className="flex-[1.4]" ariaLabel="Borrar último carácter">
            <Delete className="h-4 w-4" />
          </Tecla>
        </div>
      </div>

      <Button onClick={confirmar} disabled={!valor.trim()} className="w-full">
        <Check className="h-4 w-4" /> Confirmar
      </Button>
    </div>
  );
}
