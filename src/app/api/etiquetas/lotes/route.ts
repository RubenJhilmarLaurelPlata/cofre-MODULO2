// src/app/api/etiquetas/lotes/route.ts
// Historial de lotes: listar, buscar y filtrar (Modulo 5).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buscarLotes } from '@/lib/etiquetas';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !['ADMIN', 'RECEPCION'].includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const lotes = await buscarLotes({
    q: url.searchParams.get('q')?.trim() || undefined,
    inicial: url.searchParams.get('inicial')?.trim().toUpperCase() || undefined,
    desde: url.searchParams.get('desde') || undefined,
    hasta: url.searchParams.get('hasta') || undefined,
  });

  return NextResponse.json(lotes);
}
