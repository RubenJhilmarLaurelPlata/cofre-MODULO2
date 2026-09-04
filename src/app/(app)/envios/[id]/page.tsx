// src/app/(app)/envios/[id]/page.tsx
import { EnvioDetalleClient } from '@/components/envios/envio-detalle-client';

export const dynamic = 'force-dynamic';

export default function EnvioDetallePage({ params }: { params: { id: string } }) {
  return <EnvioDetalleClient envioId={params.id} />;
}
