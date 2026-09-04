// src/app/api/reportes/historial/route.ts
// Historial de reportes generados (auditoria): quien exporto que, cuando,
// con que filtros y en que formato.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getHistorialReportes } from '@/lib/reportes';


export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'reportes.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const historial = await getHistorialReportes();
  return NextResponse.json(historial);
}
