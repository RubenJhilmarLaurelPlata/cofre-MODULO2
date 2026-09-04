// src/app/api/etiquetas/lotes/route.ts
// Historial de lotes: listar, buscar y filtrar (Modulo 5).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buscarLotes, getLotesEtiquetasEliminables } from '@/lib/etiquetas';

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

  // Una sola consulta batched para toda la pagina — ver
  // getLotesEtiquetasEliminables() en src/lib/etiquetas.ts (nunca una
  // consulta por fila). Solo tiene sentido ofrecer "Eliminar" a un ADMIN.
  const eliminables = session.role === 'ADMIN' ? await getLotesEtiquetasEliminables(lotes.map((l) => l.id)) : new Set<string>();

  return NextResponse.json(lotes.map((l) => ({ ...l, puedeEliminarse: eliminables.has(l.id) })));
}
