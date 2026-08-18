// src/app/(app)/recepcion/page.tsx
import { prisma } from '@/lib/prisma';
import { getCompanyConfig } from '@/lib/config';
import { getSession } from '@/lib/auth';
import { RecepcionClient } from '@/components/recepcion/recepcion-client';

export const dynamic = 'force-dynamic';

function parsearMontosRapidos(config: string): number[] {
  const montos = config
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return montos.length > 0 ? montos : [2, 3, 5, 7];
}

export default async function RecepcionPage() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  const [company, series, ingresadosHoy, session] = await Promise.all([
    getCompanyConfig(),
    prisma.packageSeries.findMany({ where: { activo: true }, orderBy: { inicial: 'asc' } }),
    prisma.package.count({ where: { ingresoAt: { gte: hoy, lt: manana } } }),
    getSession(),
  ]);

  return (
    <RecepcionClient
      moneda={company.moneda}
      tarifaBase={company.tarifaBase}
      montosRapidos={parsearMontosRapidos(company.montosPagoRapido)}
      series={series.map((s) => ({ inicial: s.inicial, descripcion: s.descripcion }))}
      ingresadosHoyInicial={ingresadosHoy}
      separador={company.formatoSeparador}
      esAdmin={session?.role === 'ADMIN'}
    />
  );
}
