// src/app/(app)/envios/historial/page.tsx
import { EnviosListClient } from '@/components/envios/envios-list-client';

export const dynamic = 'force-dynamic';

export default function EnviosHistorialPage() {
  return <EnviosListClient />;
}
