// src/app/api/buscador/search/route.ts
// Busqueda combinada: codigo (exacto o parcial), remitente, destinatario,
// telefonos, observaciones, estado y rango de fechas de ingreso. Todo en
// una sola consulta a la base de datos real (sin mocks).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { toPackageDetailDTOList, construirFiltroTextoPaquete } from '@/lib/package-detail';
import { getLotesPorPackageId } from '@/lib/importacion';
import { PACKAGE_STATUSES } from '@/types';

const RESULT_LIMIT = 60;

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  estado: z.enum(PACKAGE_STATUSES).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'buscador.buscar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    estado: url.searchParams.get('estado') ?? undefined,
    desde: url.searchParams.get('desde') ?? undefined,
    hasta: url.searchParams.get('hasta') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parámetros de búsqueda inválidos.' }, { status: 400 });
  }
  const { q, estado, desde, hasta } = parsed.data;

  const where: Prisma.PackageWhereInput = {};

  if (estado) where.status = estado;

  const ingresoAt: Prisma.DateTimeFilter = {};
  if (desde) ingresoAt.gte = new Date(`${desde}T00:00:00`);
  if (hasta) {
    const fin = new Date(`${hasta}T00:00:00`);
    fin.setDate(fin.getDate() + 1);
    ingresoAt.lt = fin;
  }
  if (Object.keys(ingresoAt).length > 0) where.ingresoAt = ingresoAt;

  if (q) where.OR = construirFiltroTextoPaquete(q);

  const paquetes = await prisma.package.findMany({
    where,
    orderBy: { ingresoAt: 'desc' },
    take: RESULT_LIMIT + 1,
  });

  const truncated = paquetes.length > RESULT_LIMIT;
  const pagina = truncated ? paquetes.slice(0, RESULT_LIMIT) : paquetes;
  const resultados = await toPackageDetailDTOList(pagina);

  // Lote de importación (Fase 3): una sola consulta batched para toda la
  // página de resultados, solo para los que vinieron de una importación
  // — nunca dentro de toPackageDetailDTOList (Dashboard/Reportes no
  // pagan este costo).
  const idsImportados = pagina.filter((p) => p.origenEntrega === 'IMPORTACION').map((p) => p.id);
  const lotesPorId = await getLotesPorPackageId(idsImportados);
  const resultadosConLote = resultados.map((r, i) => (pagina[i]!.origenEntrega === 'IMPORTACION' ? { ...r, lote: lotesPorId[pagina[i]!.id] ?? null } : r));

  return NextResponse.json({ results: resultadosConLote, truncated, limit: RESULT_LIMIT });
}
