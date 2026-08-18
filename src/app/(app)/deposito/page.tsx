// src/app/(app)/deposito/page.tsx
import { prisma } from '@/lib/prisma';
import { toPackageDetailDTOList } from '@/lib/package-detail';
import { DepositoClient } from '@/components/deposito/deposito-client';

export const dynamic = 'force-dynamic';

export default async function DepositoPage() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  const [pendientesRaw, enviadosHoy] = await Promise.all([
    prisma.package.findMany({ where: { status: 'PENDIENTE_BAJAR' }, orderBy: { pendienteAt: 'asc' } }),
    prisma.package.count({ where: { depositoAt: { gte: hoy, lt: manana } } }),
  ]);
  const pendientesIniciales = await toPackageDetailDTOList(pendientesRaw);

  return <DepositoClient pendientesIniciales={pendientesIniciales} enviadosHoyInicial={enviadosHoy} />;
}
