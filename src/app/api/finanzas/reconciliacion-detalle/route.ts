// src/app/api/finanzas/reconciliacion-detalle/route.ts
// Comparacion de conjuntos por codigo: paquetes entregados en el periodo
// sin ningun pago, paquetes con pago sin entrega en el periodo, y ambos —
// la respuesta detallada, registro por registro, a "de que se componen los
// N paquetes cobrados cuando no coinciden con M entregados" (ver
// getReconciliacionDetallada en src/lib/finanzas.ts).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { getReconciliacionDetallada } from '@/lib/finanzas';
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

  const { gte, lt } = resolverRangoFechas({
    modo: modoRaw as ModoFechaReporte,
    fecha: url.searchParams.get('fecha') ?? undefined,
    fechaInicio: url.searchParams.get('fechaInicio') ?? undefined,
    fechaFin: url.searchParams.get('fechaFin') ?? undefined,
  });

  const detalle = await getReconciliacionDetallada({ desde: gte, hasta: lt });
  return NextResponse.json(detalle);
}
