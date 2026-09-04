// src/app/api/envios/fondos/route.ts
// Fase 3: dinero cobrado en esta instalación que corresponde económicamente
// a otras sucursales, todavía no entregado físicamente — ver
// getFondosPendientesPorDestino() en src/lib/envios.ts.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getFondosPendientesPorDestino } from '@/lib/envios';

export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.ver_fondos'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const fondos = await getFondosPendientesPorDestino();
  return NextResponse.json(fondos);
}
