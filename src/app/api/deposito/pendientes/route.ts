// src/app/api/deposito/pendientes/route.ts
// Lista los paquetes "Pendiente de bajar", para que la pantalla de
// Deposito pueda refrescarla manualmente (por ejemplo si otro dispositivo
// solicito bajar un paquete mientras esta pantalla ya estaba abierta).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { toPackageDetailDTOList } from '@/lib/package-detail';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'ENTREGA', 'RECEPCION', 'ADMIN_CAJA'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const pendientes = await prisma.package.findMany({
    where: { status: 'PENDIENTE_BAJAR' },
    orderBy: { pendienteAt: 'asc' },
  });

  return NextResponse.json(await toPackageDetailDTOList(pendientes));
}
