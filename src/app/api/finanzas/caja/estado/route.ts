// src/app/api/finanzas/caja/estado/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getEstadoCajaActual } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await getEstadoCajaActual());
}
