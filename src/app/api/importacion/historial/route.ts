// src/app/api/importacion/historial/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getLotesEliminables } from '@/lib/importacion';

export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.importacion'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const registros = await prisma.importLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { nombre: true } } },
  });

  // Una sola consulta batched para los hasta 100 lotes de esta página —
  // ver getLotesEliminables() en src/lib/importacion.ts (nunca una
  // consulta por fila).
  const eliminables = await getLotesEliminables(registros.map((r) => r.id));

  return NextResponse.json(
    registros.map((r) => ({
      id: r.id,
      nombreArchivo: r.nombreArchivo,
      nombreLote: r.nombreLote,
      formato: r.formato,
      tipoImportacion: r.tipoImportacion,
      detectados: r.detectados,
      validos: r.validos,
      duplicados: r.duplicados,
      invalidos: r.invalidos,
      marcadosEntregado: r.marcadosEntregado,
      noEncontrados: r.noEncontrados,
      creadosFaltantes: r.creadosFaltantes,
      usuario: r.user?.nombre ?? 'Sistema',
      createdAt: r.createdAt.toISOString(),
      puedeEliminarse: eliminables.has(r.id),
      // Revertir (distinto de eliminar): solo tiene sentido para un lote
      // que SÍ tuvo efecto real (lo contrario de puedeEliminarse) y que
      // todavía no fue revertido antes — ver revertirLoteImportacion() en
      // src/lib/importacion.ts.
      puedeRevertirse: !eliminables.has(r.id) && !r.revertidoAt,
      revertidoAt: r.revertidoAt ? r.revertidoAt.toISOString() : null,
    }))
  );
}
