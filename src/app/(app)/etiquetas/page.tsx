// src/app/(app)/etiquetas/page.tsx
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { getMonthLetters } from '@/lib/etiquetas';
import { EtiquetasClient } from '@/components/etiquetas/etiquetas-client';

export const dynamic = 'force-dynamic';

export default async function EtiquetasPage() {
  const session = await getSession();

  const [series, monthLetters, company] = await Promise.all([
    prisma.packageSeries.findMany({ where: { activo: true }, orderBy: { inicial: 'asc' } }),
    getMonthLetters(),
    getCompanyConfig(),
  ]);

  return (
    <EtiquetasClient
      esAdmin={session?.role === 'ADMIN'}
      seriesIniciales={series.map((s) => ({ inicial: s.inicial, descripcion: s.descripcion, correlativo: s.correlativo }))}
      monthLettersIniciales={monthLetters}
      separadorDefault={company.formatoSeparador}
    />
  );
}
