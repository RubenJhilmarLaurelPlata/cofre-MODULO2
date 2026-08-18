// src/app/(app)/importacion/page.tsx
import { ImportacionClient } from '@/components/importacion/importacion-client';

export const dynamic = 'force-dynamic';

export default function ImportacionPage() {
  return <ImportacionClient />;
}
