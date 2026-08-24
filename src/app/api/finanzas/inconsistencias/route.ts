// src/app/api/finanzas/inconsistencias/route.ts
// Inconsistencias de integridad de datos, sobre TODA la base (no un
// periodo — ver getInconsistenciasGlobales en src/lib/finanzas.ts). Nunca
// corrige nada: solo reporta, con motivo y accion recomendada, para que un
// ADMIN decida.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getInconsistenciasGlobales } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const inconsistencias = await getInconsistenciasGlobales();
  return NextResponse.json({ inconsistencias });
}
