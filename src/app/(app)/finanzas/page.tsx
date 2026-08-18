// src/app/(app)/finanzas/page.tsx
import { getCompanyConfig } from '@/lib/config';
import { FinanzasClient } from '@/components/finanzas/finanzas-client';

export const dynamic = 'force-dynamic';

export default async function FinanzasPage() {
  const company = await getCompanyConfig();
  return <FinanzasClient moneda={company.moneda} />;
}
