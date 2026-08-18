// src/app/api/importacion/historial/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const registros = await prisma.importLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { nombre: true } } },
  });

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
    }))
  );
}
