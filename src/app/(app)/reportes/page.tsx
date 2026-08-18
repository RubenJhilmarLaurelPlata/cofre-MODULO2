// src/app/(app)/reportes/page.tsx
import { prisma } from '@/lib/prisma';
import { getUsuariosParaFiltro } from '@/lib/reportes';
import { ReportesClient } from '@/components/reportes/reportes-client';

export const dynamic = 'force-dynamic';

export default async function ReportesPage() {
  const [usuarios, series] = await Promise.all([
    getUsuariosParaFiltro(),
    prisma.packageSeries.findMany({ where: { activo: true }, orderBy: { inicial: 'asc' }, select: { inicial: true, descripcion: true } }),
  ]);

  return <ReportesClient usuarios={usuarios} series={series} />;
}
