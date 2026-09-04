// src/app/api/finanzas/caja/estado/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getEstadoCajaActual } from '@/lib/finanzas';


export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'finanzas.ver_caja'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await getEstadoCajaActual());
}
