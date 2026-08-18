// src/app/api/importacion/[id]/route.ts
// Detalle de un lote de importacion: el ImportLog (agregados) + sus
// ImportRow paginadas y filtrables por estado / buscables por codigo o
// persona — consulta indexada, nunca carga las filas de un archivo
// grande de una sola vez (mismo criterio de paginacion que se aplico en
// Fase 1 a src/lib/dashboard-data.ts).
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const TAMANO_PAGINA = 100;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const log = await prisma.importLog.findUnique({
    where: { id: params.id },
    include: { user: { select: { nombre: true } } },
  });
  if (!log) {
    return NextResponse.json({ error: 'No se encontró esa importación.' }, { status: 404 });
  }

  const url = req.nextUrl;
  const estado = url.searchParams.get('estado') || undefined;
  const buscar = url.searchParams.get('buscar')?.trim() || undefined;
  const pagina = Math.max(1, Number(url.searchParams.get('pagina') ?? '1') || 1);

  const where = {
    importLogId: log.id,
    ...(estado ? { estado } : {}),
    ...(buscar
      ? {
          OR: [
            { codigo: { contains: buscar } },
            { codigoOficial: { contains: buscar } },
            { persona: { contains: buscar } },
          ],
        }
      : {}),
  };

  const [total, filas, conteoPorEstado] = await Promise.all([
    prisma.importRow.count({ where }),
    prisma.importRow.findMany({
      where,
      orderBy: { numeroFila: 'asc' },
      skip: (pagina - 1) * TAMANO_PAGINA,
      take: TAMANO_PAGINA,
    }),
    prisma.importRow.groupBy({ by: ['estado'], where: { importLogId: log.id }, _count: { estado: true } }),
  ]);

  return NextResponse.json({
    lote: {
      id: log.id,
      nombreArchivo: log.nombreArchivo,
      nombreLote: log.nombreLote,
      formato: log.formato,
      tipoImportacion: log.tipoImportacion,
      detectados: log.detectados,
      validos: log.validos,
      duplicados: log.duplicados,
      invalidos: log.invalidos,
      marcadosEntregado: log.marcadosEntregado,
      noEncontrados: log.noEncontrados,
      creadosFaltantes: log.creadosFaltantes,
      usuario: log.user?.nombre ?? 'Sistema',
      createdAt: log.createdAt.toISOString(),
    },
    conteoPorEstado: Object.fromEntries(conteoPorEstado.map((c) => [c.estado, c._count.estado])),
    filas,
    total,
    pagina,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
  });
}
