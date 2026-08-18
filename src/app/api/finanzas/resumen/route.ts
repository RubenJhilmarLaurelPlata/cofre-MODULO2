// src/app/api/finanzas/resumen/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { getResumenFinanciero } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const modoRaw = url.searchParams.get('modo') ?? 'hoy';
  if (!MODOS_FECHA.includes(modoRaw as ModoFechaReporte)) {
    return NextResponse.json({ error: 'Modo de fecha inválido.' }, { status: 400 });
  }

  const { gte, lt, etiqueta } = resolverRangoFechas({
    modo: modoRaw as ModoFechaReporte,
    fecha: url.searchParams.get('fecha') ?? undefined,
    fechaInicio: url.searchParams.get('fechaInicio') ?? undefined,
    fechaFin: url.searchParams.get('fechaFin') ?? undefined,
  });

  const resumen = await getResumenFinanciero({ desde: gte, hasta: lt });
  return NextResponse.json({ ...resumen, etiqueta, desde: gte.toISOString(), hasta: lt.toISOString() });
}
