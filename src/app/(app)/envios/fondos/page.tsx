// src/app/(app)/envios/fondos/page.tsx
import { FondosEnvioClient } from '@/components/envios/fondos-envio-client';

export const dynamic = 'force-dynamic';

export default function EnviosFondosPage() {
  return <FondosEnvioClient />;
}
