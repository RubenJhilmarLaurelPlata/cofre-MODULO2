'use client';

// src/components/buscador/package-detail-modal.tsx
import * as React from 'react';
import { X, Calendar, Clock, Wallet, User, Phone, FileText, Archive, ArrowDownToLine, Ban, History as HistoryIcon } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import type { PackageDetailDTO, HistorialItemDTO } from '@/lib/package-detail';

interface PackageDetailModalProps {
  detalle: PackageDetailDTO;
  tab: 'detalle' | 'historial';
  onTabChange: (tab: 'detalle' | 'historial') => void;
  historial: HistorialItemDTO[] | undefined;
  cargandoHistorial: boolean;
  onClose: () => void;
}

function fmtFechaCompleta(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

const ESTADO_HISTORIAL_LABEL: Record<string, string> = {
  EN_PAQUETERIA: 'Ingresó a paquetería',
  EN_DEPOSITO: 'Enviado a depósito',
  PENDIENTE_BAJAR: 'Solicitado bajar de depósito',
  ENTREGADO: 'Entregado',
  DENEGADO: 'Denegado',
  PAGO_ANTICIPO: 'Pago anticipado',
  PAGO_COBRO_ENTREGA: 'Cobro registrado',
  PAGO_AJUSTE: 'Corrección de cobro',
};

function esEventoPago(estado: string): boolean {
  return estado.startsWith('PAGO_');
}

export function PackageDetailModal({ detalle, tab, onTabChange, historial, cargandoHistorial, onClose }: PackageDetailModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between border-b border-gray-100 dark:border-gray-800/60 bg-white dark:bg-gray-900 p-5">
          <div>
            <p className="font-mono text-2xl font-bold text-ink dark:text-gray-100">{detalle.code}</p>
            <div className="mt-1">
              <StatusBadge status={detalle.status} />
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-ink dark:hover:text-gray-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800/60 px-5 pt-3">
          <button
            onClick={() => onTabChange('detalle')}
            className={cn(
              'rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === 'detalle' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            Detalle completo
          </button>
          <button
            onClick={() => onTabChange('historial')}
            className={cn(
              'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === 'historial' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            <HistoryIcon className="h-3.5 w-3.5" /> Historial
          </button>
        </div>

        {tab === 'detalle' ? (
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Calendar className="h-3.5 w-3.5" /> Ingreso
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaCompleta(detalle.ingresoAt)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Clock className="h-3.5 w-3.5" /> Días almacenado
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{detalle.dias}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Archive className="h-3.5 w-3.5" /> Enviado a depósito
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaCompleta(detalle.depositoAt)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <ArrowDownToLine className="h-3.5 w-3.5" /> Solicitado bajar
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaCompleta(detalle.pendienteAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Entrega</p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaCompleta(detalle.entregaAt)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Ban className="h-3.5 w-3.5" /> Denegado
                </p>
                <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFechaCompleta(detalle.denegadoAt)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
                <Wallet className="h-3.5 w-3.5" /> Costo acumulado
              </p>
              <p className="text-xl font-semibold text-ink dark:text-gray-100">
                {detalle.moneda} {detalle.costoAcumulado.toFixed(2)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
                  <User className="h-3.5 w-3.5" /> Remitente
                </p>
                <p className="text-sm text-ink dark:text-gray-100">{detalle.remitente || '—'}</p>
                {detalle.remitenteTelefono && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft dark:text-gray-400">
                    <Phone className="h-3 w-3" /> {detalle.remitenteTelefono}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
                  <User className="h-3.5 w-3.5" /> Destinatario
                </p>
                <p className="text-sm text-ink dark:text-gray-100">{detalle.destinatario || '—'}</p>
                {detalle.destinatarioTelefono && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft dark:text-gray-400">
                    <Phone className="h-3 w-3" /> {detalle.destinatarioTelefono}
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
                <FileText className="h-3.5 w-3.5" /> Observaciones
              </p>
              <p className="whitespace-pre-wrap text-sm text-ink dark:text-gray-100">{detalle.observaciones || 'Sin observaciones.'}</p>
            </div>
          </div>
        ) : (
          <div className="p-5">
            {cargandoHistorial ? (
              <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Cargando historial…</p>
            ) : !historial || historial.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Este paquete todavía no tiene historial.</p>
            ) : (
              <ol className="space-y-4 border-l-2 border-gray-100 dark:border-gray-800/60 pl-4">
                {historial.map((h, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${esEventoPago(h.estado) ? 'bg-emerald-500' : 'bg-brand-500'}`} />
                    <p className="text-sm font-medium text-ink dark:text-gray-100">{ESTADO_HISTORIAL_LABEL[h.estado] ?? h.estado}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {fmtFechaCompleta(h.fecha)} — {h.usuario}
                    </p>
                    {h.nota && <p className="mt-0.5 text-xs text-ink-soft dark:text-gray-400">{h.nota}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
