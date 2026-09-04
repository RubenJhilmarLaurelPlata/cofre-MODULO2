// src/app/api/finanzas/reconciliacion/route.ts
// Responde exactamente "de que se componen los N paquetes cobrados"
// cuando no coincide con "M entregados": entregas normales/excepcionales/
// vía importación, cobros de entrega/anticipos/ajustes, y cuántos cobros
// del período no están asociados a una entrega del mismo período (ver
// getReconciliacion en src/lib/finanzas.ts).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { getReconciliacion } from '@/lib/finanzas';


export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'finanzas.ver_caja'))) {
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

  const reconciliacion = await getReconciliacion({ desde: gte, hasta: lt });
  return NextResponse.json({ ...reconciliacion, etiqueta });
}
