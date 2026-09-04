// src/components/envios/estado-envio.ts
// Fase 3: origen único de verdad para cómo se ve cada estado de Envio en
// toda la UI — antes duplicado de forma independiente en
// envios-list-client.tsx, envio-detalle-client.tsx y
// recibir-envio-client.tsx, con riesgo real de que divergieran entre sí.
// Los nombres INTERNOS de estado (BORRADOR/CERRADO/RECIBIDO/CANCELADO) no
// cambian — esto solo centraliza su representación visual.
export type EstadoEnvio = 'BORRADOR' | 'CERRADO' | 'RECIBIDO' | 'CANCELADO';

export interface EstadoEnvioInfo {
  label: string;
  descripcion: string;
  variant: 'warning' | 'success' | 'info' | 'neutral' | 'danger';
  dot: string; // color del punto/emoji-equivalente, para listas compactas
}

export const ESTADO_ENVIO_INFO: Record<string, EstadoEnvioInfo> = {
  BORRADOR: { label: 'Preparado para envío', descripcion: 'Todavía en esta sucursal, se puede seguir editando.', variant: 'warning', dot: 'bg-amber-500' },
  CERRADO: { label: 'En tránsito', descripcion: 'Ya salió de esta sucursal, no disponible aquí hasta que el destino lo reciba.', variant: 'info', dot: 'bg-blue-500' },
  RECIBIDO: { label: 'Recibido en destino', descripcion: 'El destino confirmó la recepción — sus paquetes ya están disponibles ahí.', variant: 'success', dot: 'bg-emerald-500' },
  CANCELADO: { label: 'Cancelado', descripcion: 'Se canceló antes de salir; sus paquetes quedaron libres.', variant: 'danger', dot: 'bg-red-500' },
};

export function getEstadoEnvioInfo(estado: string): EstadoEnvioInfo {
  return ESTADO_ENVIO_INFO[estado] ?? { label: estado, descripcion: '', variant: 'neutral', dot: 'bg-gray-400' };
}
