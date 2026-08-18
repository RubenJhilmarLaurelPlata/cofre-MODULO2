// src/app/api/reportes/historial/route.ts
// Historial de reportes generados (auditoria): quien exporto que, cuando,
// con que filtros y en que formato.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getHistorialReportes } from '@/lib/reportes';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const historial = await getHistorialReportes();
  return NextResponse.json(historial);
}
