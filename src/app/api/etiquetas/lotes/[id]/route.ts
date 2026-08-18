// src/app/api/etiquetas/lotes/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !['ADMIN', 'RECEPCION'].includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const lote = await prisma.labelBatch.findUnique({
    where: { id: params.id },
    include: { generadoPor: { select: { nombre: true } }, codigos: { select: { code: true, fechaGenerado: true, usado: true } } },
  });
  if (!lote) {
    return NextResponse.json({ error: 'No se encontró ese lote.' }, { status: 404 });
  }

  return NextResponse.json({
    id: lote.id,
    inicial: lote.inicial,
    fechaInicio: lote.fechaInicio,
    fechaFin: lote.fechaFin,
    cantidadPorDia: lote.cantidadPorDia,
    cantidad: lote.cantidad,
    separador: lote.separador,
    primerConsecutivo: lote.primerConsecutivo,
    ultimoConsecutivo: lote.ultimoConsecutivo,
    observaciones: lote.observaciones,
    generadoPor: lote.generadoPor?.nombre ?? 'Sistema',
    createdAt: lote.createdAt.toISOString(),
    usados: lote.codigos.filter((c) => c.usado).length,
    codigos: lote.codigos.map((c) => ({ code: c.code, fecha: c.fechaGenerado, usado: c.usado })),
  });
}
