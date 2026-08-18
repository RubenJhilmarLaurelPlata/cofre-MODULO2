// src/app/(app)/importacion/[id]/page.tsx
import { LoteDetalleClient } from '@/components/importacion/lote-detalle-client';

export const dynamic = 'force-dynamic';

export default function LoteDetallePage({ params }: { params: { id: string } }) {
  return <LoteDetalleClient loteId={params.id} />;
}
