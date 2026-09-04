// src/app/(app)/envios/page.tsx
import { EnviosListClient } from '@/components/envios/envios-list-client';

export const dynamic = 'force-dynamic';

export default function EnviosPage() {
  return <EnviosListClient />;
}
