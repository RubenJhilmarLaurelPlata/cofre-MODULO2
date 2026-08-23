// src/components/buscador/resultado-destacado.tsx
// Notificacion grande de estado (seccion "Notificacion del estado al
// buscar"): antes, encontrar un paquete por su codigo exacto (el caso mas
// comun del Buscador — escanear y ver que pasa) mostraba la MISMA tarjeta
// chica que una busqueda con muchos resultados, con el estado reducido a
// un badge pequeño. Esto es imposible de confundir: icono, color y texto
// grandes, y solo los datos reales que ya trae PackageDetailDTO (nunca un
// campo inventado — "operador de la entrega" y "motivo de denegacion"
// puntuales quedan en el boton "Historial", que ya los muestra con su
// propia consulta, para no duplicar esa logica aqui).
import { Boxes, Archive, ArrowDownToLine, CheckCircle2, Ban } from 'lucide-react';
import type { PackageStatus } from '@/types';
import type { PackageDetailDTO } from '@/lib/package-detail';

const CONFIG: Record<PackageStatus, { icon: typeof Boxes; titulo: string; subtitulo: string; clases: string; iconoClases: string }> = {
  EN_PAQUETERIA: {
    icon: Boxes,
    titulo: 'El paquete sigue en Cofre Express',
    subtitulo: 'Pendiente de entrega',
    clases: 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-500/10',
    iconoClases: 'bg-blue-500',
  },
  EN_DEPOSITO: {
    icon: Archive,
    titulo: 'El paquete está en depósito',
    subtitulo: 'Debe solicitarse su bajada antes de poder entregarse',
    clases: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-500/10',
    iconoClases: 'bg-amber-500',
  },
  PENDIENTE_BAJAR: {
    icon: ArrowDownToLine,
    titulo: 'Pendiente de bajar de depósito',
    subtitulo: 'Ya fue solicitado — todavía no puede entregarse',
    clases: 'border-brand-200 bg-brand-50 dark:border-brand-900/50 dark:bg-brand-500/10',
    iconoClases: 'bg-brand-500',
  },
  ENTREGADO: {
    icon: CheckCircle2,
    titulo: 'Paquete entregado',
    subtitulo: 'Ya fue retirado',
    clases: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-500/10',
    iconoClases: 'bg-emerald-500',
  },
  DENEGADO: {
    icon: Ban,
    titulo: 'Paquete denegado',
    subtitulo: 'No puede entregarse',
    clases: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-500/10',
    iconoClases: 'bg-red-500',
  },
};

function fmtFechaHora(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function ResultadoDestacado({ p }: { p: PackageDetailDTO }) {
  const cfg = CONFIG[p.status] ?? CONFIG.EN_PAQUETERIA;
  const Icon = cfg.icon;

  return (
    <div className={`animate-scale-in rounded-2xl border-2 p-5 ${cfg.clases}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white ${cfg.iconoClases}`}>
          <Icon className="h-7 w-7" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold leading-tight text-ink dark:text-gray-100">{cfg.titulo}</p>
          <p className="text-sm text-ink-soft dark:text-gray-400">{cfg.subtitulo}</p>
          <p className="mt-1.5 truncate font-mono text-2xl font-bold text-ink dark:text-gray-100">{p.code}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-black/5 dark:border-white/5 pt-4 text-sm sm:grid-cols-3">
        {(p.destinatario || p.cliente?.nombre) && (
          <div>
            <dt className="text-xs text-gray-400 dark:text-gray-500">Nombre</dt>
            <dd className="font-medium text-ink dark:text-gray-100">{p.destinatario || p.cliente?.nombre}</dd>
          </div>
        )}
        {(p.destinatarioTelefono || p.cliente?.telefono) && (
          <div>
            <dt className="text-xs text-gray-400 dark:text-gray-500">Celular</dt>
            <dd className="font-medium text-ink dark:text-gray-100">{p.destinatarioTelefono || p.cliente?.telefono}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-gray-400 dark:text-gray-500">Recibido</dt>
          <dd className="font-medium text-ink dark:text-gray-100">{fmtFechaHora(p.ingresoAt)}</dd>
        </div>

        {p.status === 'ENTREGADO' ? (
          <>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Entregado</dt>
              <dd className="font-medium text-ink dark:text-gray-100">{fmtFechaHora(p.entregaAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Monto cobrado</dt>
              <dd className="font-medium text-ink dark:text-gray-100">{p.moneda} {p.montoPagado.toFixed(2)}</dd>
            </div>
          </>
        ) : p.status === 'DENEGADO' ? (
          <>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Denegado</dt>
              <dd className="font-medium text-ink dark:text-gray-100">{fmtFechaHora(p.denegadoAt)}</dd>
            </div>
            {p.observaciones && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-400 dark:text-gray-500">Motivo / observaciones</dt>
                <dd className="font-medium text-ink dark:text-gray-100">{p.observaciones}</dd>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Días transcurridos</dt>
              <dd className="font-medium text-ink dark:text-gray-100">{p.dias}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Monto</dt>
              <dd className="font-medium text-ink dark:text-gray-100">{p.moneda} {p.costoAcumulado.toFixed(2)}</dd>
            </div>
            {p.saldoPendiente > 0 && (
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">Pendiente</dt>
                <dd className="font-semibold text-red-600 dark:text-red-400">{p.moneda} {p.saldoPendiente.toFixed(2)}</dd>
              </div>
            )}
          </>
        )}
      </dl>
    </div>
  );
}
