// src/app/(app)/configuracion/page.tsx
import { ConfiguracionClient } from '@/components/configuracion/configuracion-client';

export const dynamic = 'force-dynamic';

export default function ConfiguracionPage() {
  return <ConfiguracionClient />;
}
