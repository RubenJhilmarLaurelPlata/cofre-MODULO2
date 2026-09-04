// src/app/api/importacion/[id]/route.ts
// Detalle de un lote de importacion: el ImportLog (agregados) + sus
// ImportRow paginadas y filtrables por estado / buscables por codigo o
// persona — consulta indexada, nunca carga las filas de un archivo
// grande de una sola vez (mismo criterio de paginacion que se aplico en
// Fase 1 a src/lib/dashboard-data.ts).
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { eliminarLoteImportacion, LoteNoEncontradoError, LoteConEfectoRealError, ESTADOS_CON_EFECTO_REAL } from '@/lib/importacion';

const TAMANO_PAGINA = 100;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.importacion'))) {
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
      revertidoAt: log.revertidoAt ? log.revertidoAt.toISOString() : null,
    },
    conteoPorEstado: Object.fromEntries(conteoPorEstado.map((c) => [c.estado, c._count.estado])),
    // Derivado del mismo conteoPorEstado que ya se calculó arriba (sin
    // consulta extra): si ninguna fila del lote quedó en un estado con
    // efecto real, es seguro ofrecer "Eliminar lista" — ver comentario de
    // eliminarLoteImportacion() en src/lib/importacion.ts.
    puedeEliminarse: !conteoPorEstado.some((c) => ESTADOS_CON_EFECTO_REAL.includes(c.estado)),
    puedeRevertirse: conteoPorEstado.some((c) => ESTADOS_CON_EFECTO_REAL.includes(c.estado)) && !log.revertidoAt,
    filas,
    total,
    pagina,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
  });
}

/** Elimina un lote completo — solo si ninguna de sus filas tuvo efecto real (ver eliminarLoteImportacion en src/lib/importacion.ts). Transaccional; nunca toca Package/Pago/PackageHistory. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.importacion'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const eliminado = await eliminarLoteImportacion(params.id, session.id);
    return NextResponse.json({ ok: true, ...eliminado });
  } catch (err) {
    if (err instanceof LoteNoEncontradoError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof LoteConEfectoRealError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Error eliminando lote de importación:', err);
    return NextResponse.json({ error: 'Ocurrió un error al eliminar la lista.' }, { status: 500 });
  }
}
