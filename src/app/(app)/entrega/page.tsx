// src/app/(app)/entrega/page.tsx
import { prisma } from '@/lib/prisma';
import { getPackageDetail } from '@/lib/package-detail';
import type { EntregaRecienteDTO } from '@/lib/package-detail';
import { getLotesPorPackageId } from '@/lib/importacion';
import { getCompanyConfig } from '@/lib/config';
import { getSession } from '@/lib/auth';
import { EntregaClient } from '@/components/entrega/entrega-client';
import type { PaymentStatus } from '@/types';

export const dynamic = 'force-dynamic';

interface EntregaPageProps {
  searchParams: { code?: string };
}

const LIMITE_RECIENTES = 15;

export default async function EntregaPage({ searchParams }: EntregaPageProps) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  const codigoInicial = searchParams.code?.trim().toUpperCase() || undefined;

  const [entregadosHoy, entregadosRecientesRaw, paqueteInicial, company, session] = await Promise.all([
    prisma.package.count({ where: { entregaAt: { gte: hoy, lt: manana } } }),
    prisma.package.findMany({
      where: { entregaAt: { gte: hoy, lt: manana } },
      orderBy: { entregaAt: 'desc' },
      take: LIMITE_RECIENTES,
      select: { id: true, code: true, entregaAt: true, montoPagado: true, estadoPago: true, destinatario: true, origenEntrega: true },
    }),
    codigoInicial ? getPackageDetail(codigoInicial) : Promise.resolve(null),
    getCompanyConfig(),
    getSession(),
  ]);

  const lotesPorPackageId = await getLotesPorPackageId(entregadosRecientesRaw.filter((p) => p.origenEntrega === 'IMPORTACION').map((p) => p.id));
  const entregadosRecientes: EntregaRecienteDTO[] = entregadosRecientesRaw.map((p) => ({
    code: p.code,
    entregaAt: p.entregaAt!,
    montoPagado: p.montoPagado,
    estadoPago: p.estadoPago as PaymentStatus,
    destinatario: p.destinatario,
    origenEntrega: p.origenEntrega,
    lote: p.origenEntrega === 'IMPORTACION' ? (lotesPorPackageId[p.id] ?? null) : null,
  }));

  return (
    <EntregaClient
      entregadosHoyInicial={entregadosHoy}
      entregadosRecientesIniciales={entregadosRecientes}
      codigoInicial={codigoInicial}
      paqueteInicial={paqueteInicial}
      countdownSegundos={company.entregaCountdownSegundos}
      esAdmin={session?.role === 'ADMIN'}
      moneda={company.moneda}
    />
  );
}
