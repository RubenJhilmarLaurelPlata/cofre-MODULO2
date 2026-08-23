// src/app/api/finanzas/pagos/route.ts
// Desglose de Finanzas: cada Pago del período (código, monto, fecha/hora,
// operador) que compone el total de "Ingresos" en /api/finanzas/resumen —
// mismo rango de fechas, misma fuente de verdad (getResumenFinanciero usa
// exactamente la misma consulta a Pago, ver src/lib/finanzas.ts).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { listarPagosPeriodo } from '@/lib/finanzas';
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

  const pagos = await listarPagosPeriodo({ desde: gte, hasta: lt });
  return NextResponse.json({ pagos });
}
