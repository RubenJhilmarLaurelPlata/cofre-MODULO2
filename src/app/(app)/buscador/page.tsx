// src/app/(app)/buscador/page.tsx
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { toPackageDetailDTOList } from '@/lib/package-detail';
import { puedeAcceder } from '@/types';
import { BuscadorClient } from '@/components/buscador/buscador-client';

export const dynamic = 'force-dynamic';

const RESULT_LIMIT = 60;

export default async function BuscadorPage() {
  const session = await getSession();

  const recientes = await prisma.package.findMany({
    orderBy: { ingresoAt: 'desc' },
    take: 20,
  });
  const resultadosIniciales = await toPackageDetailDTOList(recientes);

  const puedeIrAEntrega = !!session && puedeAcceder(session.role, 'entrega');
  const puedeEnviarADeposito = !!session && puedeAcceder(session.role, 'deposito');

  return (
    <BuscadorClient
      resultadosIniciales={resultadosIniciales}
      limite={RESULT_LIMIT}
      puedeIrAEntrega={puedeIrAEntrega}
      puedeEnviarADeposito={puedeEnviarADeposito}
    />
  );
}
