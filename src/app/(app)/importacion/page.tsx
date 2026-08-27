// src/app/(app)/importacion/page.tsx
import { ImportacionClient } from '@/components/importacion/importacion-client';
import { getCompanyConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function ImportacionPage() {
  const company = await getCompanyConfig();
  return <ImportacionClient tarifaBase={company.tarifaBase} />;
}
