// src/app/(app)/envios/nuevo/page.tsx
import { NuevoEnvioClient } from '@/components/envios/nuevo-envio-client';

export const dynamic = 'force-dynamic';

export default function NuevoEnvioPage() {
  return <NuevoEnvioClient />;
}
