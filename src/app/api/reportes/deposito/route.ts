// src/app/api/reportes/deposito/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getReporteDeposito, parseFiltrosReporte } from '@/lib/reportes';


export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'reportes.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const filtros = parseFiltrosReporte(new URL(req.url));
  if ('error' in filtros) return NextResponse.json(filtros, { status: 400 });

  const resultado = await getReporteDeposito(filtros);
  return NextResponse.json(resultado);
}
