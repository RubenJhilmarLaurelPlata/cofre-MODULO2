// src/app/api/finanzas/inconsistencias/route.ts
// Inconsistencias de integridad de datos, sobre TODA la base (no un
// periodo — ver getInconsistenciasGlobales en src/lib/finanzas.ts). Nunca
// corrige nada: solo reporta, con motivo y accion recomendada, para que un
// ADMIN decida.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getInconsistenciasGlobales } from '@/lib/finanzas';


export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'finanzas.ver_caja'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const inconsistencias = await getInconsistenciasGlobales();
  return NextResponse.json({ inconsistencias });
}
