'use client';

// src/components/recepcion/lote-activo-panel.tsx
// Fase 4B: panel compacto (SectionBar, no otra Card grande) que muestra el
// lote de codigos personalizados en curso — nombre/prefijo, rango, monto,
// dias incluidos, progreso de uso. Si hay mas de uno abierto, un selector
// simple para elegir cual mostrar. "+ Nuevo lote" solo para Admin.
import * as React from 'react';
import { Layers, Plus, ChevronDown } from 'lucide-react';
import { SectionBar } from '@/components/ui/card';
import { NuevoLoteModal } from '@/components/recepcion/nuevo-lote-modal';
import { cn } from '@/lib/utils';

interface LoteActivo {
  id: string;
  inicial: string;
  prefijoCompleto: string;
  nombre: string | null;
  separador: string;
  primerConsecutivo: number;
  ultimoConsecutivo: number;
  cantidad: number;
  usados: number;
  monto: number | null;
  diasIncluidos: number | null;
  createdAt: string;
}

export function LoteActivoPanel({
  moneda,
  separador,
  esAdmin,
  actualizarToken,
}: {
  moneda: string;
  separador: string;
  esAdmin: boolean;
  // Se incrementa en RecepcionClient despues de cada registro exitoso —
  // es la unica forma en que este panel se entera de que el progreso
  // (usados/cantidad) del lote pudo haber cambiado, ya que el escaneo en
  // si ocurre en un componente hermano, no en este.
  actualizarToken: number;
}) {
  const [lotes, setLotes] = React.useState<LoteActivo[] | null>(null);
  const [seleccionado, setSeleccionado] = React.useState(0);
  const [selectorAbierto, setSelectorAbierto] = React.useState(false);
  const [modalAbierto, setModalAbierto] = React.useState(false);

  const cargar = React.useCallback(() => {
    fetch('/api/recepcion/lotes/activos')
      .then((r) => r.json())
      .then((data) => {
        const nuevos: LoteActivo[] = data.lotes ?? [];
        setLotes(nuevos);
        // Preserva la seleccion si sigue siendo valida (un refresco por
        // escaneo no debe saltar al admin de vuelta al primer lote).
        setSeleccionado((prev) => (prev < nuevos.length ? prev : 0));
      })
      .catch(() => setLotes([]));
  }, []);

  React.useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar, actualizarToken]);

  if (lotes === null) return null; // primera carga: sin parpadeo de "no hay lotes"

  const lote = lotes[seleccionado];

  return (
    <>
      {lote ? (
        <SectionBar>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">Lote activo</span>
              {lotes.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSelectorAbierto((v) => !v)}
                  className="flex items-center text-gray-400 hover:text-ink dark:hover:text-gray-100"
                  aria-label="Cambiar lote"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', selectorAbierto && 'rotate-180')} />
                </button>
              )}
            </div>
            {esAdmin && (
              <button
                type="button"
                onClick={() => setModalAbierto(true)}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                <Plus className="h-3 w-3" /> Nuevo lote
              </button>
            )}
          </div>

          {selectorAbierto && lotes.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {lotes.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setSeleccionado(i);
                    setSelectorAbierto(false);
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs font-medium',
                    i === seleccionado
                      ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                      : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400'
                  )}
                >
                  {l.nombre || l.prefijoCompleto}
                </button>
              ))}
            </div>
          )}

          <p className="text-lg font-bold text-ink dark:text-gray-100">
            {lote.nombre || (
              <span className="font-mono">{`${lote.prefijoCompleto}${lote.separador}${lote.primerConsecutivo}–${lote.ultimoConsecutivo}`}</span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft dark:text-gray-400">
            {lote.nombre && (
              <span className="font-mono">
                {lote.prefijoCompleto}
                {lote.separador}
                {lote.primerConsecutivo}–{lote.ultimoConsecutivo}
              </span>
            )}
            {lote.monto !== null && (
              <span>
                {moneda} {lote.monto.toFixed(2)}
              </span>
            )}
            {lote.diasIncluidos !== null && <span>{lote.diasIncluidos} días</span>}
          </div>

          <div className="mt-2.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${Math.min(100, (lote.usados / lote.cantidad) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-right text-[11px] text-gray-400 dark:text-gray-500">
              {lote.usados} / {lote.cantidad}
            </p>
          </div>
        </SectionBar>
      ) : (
        esAdmin && (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-800 px-4 py-3 text-sm font-medium text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
          >
            <Plus className="h-4 w-4" /> Nuevo lote
          </button>
        )
      )}

      {modalAbierto && <NuevoLoteModal moneda={moneda} separador={separador} onClose={() => setModalAbierto(false)} onCreado={cargar} />}
    </>
  );
}
