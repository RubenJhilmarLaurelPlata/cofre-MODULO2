// src/app/api/reportes/paquetes/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getReportePaquetes, parseFiltrosReporte } from '@/lib/reportes';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const filtros = parseFiltrosReporte(new URL(req.url));
  if ('error' in filtros) return NextResponse.json(filtros, { status: 400 });

  const resultado = await getReportePaquetes(filtros);
  return NextResponse.json(resultado);
}
