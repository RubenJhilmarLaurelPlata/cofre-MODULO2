// src/app/api/etiquetas/ultimo-consecutivo/route.ts
// Ultimo consecutivo ya usado para una inicial EN UN DIA especifico — lo
// usa el boton "Continuar lote" (generar-tab.tsx) para modos de un solo
// dia (hoy/mañana/fecha específica). Ver obtenerUltimoConsecutivoDelDia()
// en src/lib/etiquetas.ts: la numeracion es por dia+serie, asi que
// "continuar" nunca debe arrastrar el numero de otro dia.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { obtenerUltimoConsecutivoDelDia } from '@/lib/etiquetas';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'etiquetas.generar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const inicial = url.searchParams.get('inicial')?.trim().toUpperCase();
  const fecha = url.searchParams.get('fecha');
  if (!inicial || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: 'Falta la inicial o la fecha (YYYY-MM-DD).' }, { status: 400 });
  }

  const ultimoConsecutivo = await obtenerUltimoConsecutivoDelDia(inicial, fecha);
  return NextResponse.json({ ultimoConsecutivo });
}
