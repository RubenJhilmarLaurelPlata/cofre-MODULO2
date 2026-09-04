// src/app/api/importacion/[id]/revertir/route.ts
// Reversión administrativa de un lote de importación que SÍ generó
// efectos reales (a diferencia de DELETE /api/importacion/[id], que solo
// borra lotes sin ningún efecto) — ver revertirLoteImportacion() en
// src/lib/importacion.ts para el detalle de qué es y no es reversible.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { previsualizarReversion, revertirLoteImportacion, LoteNoEncontradoError, LoteYaRevertidoError, LoteSinEfectoParaRevertirError } from '@/lib/importacion';

/** Vista previa (sin escribir nada) para el diálogo de confirmación fuerte del frontend. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.importacion'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const preview = await previsualizarReversion(params.id);
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof LoteNoEncontradoError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('Error previsualizando reversión de importación:', err);
    return NextResponse.json({ error: 'Ocurrió un error al previsualizar la reversión.' }, { status: 500 });
  }
}

/** Ejecuta la reversión — transaccional, ver revertirLoteImportacion(). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.importacion'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const resultado = await revertirLoteImportacion(params.id, session.id);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    if (err instanceof LoteNoEncontradoError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof LoteYaRevertidoError || err instanceof LoteSinEfectoParaRevertirError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Error revirtiendo importación:', err);
    return NextResponse.json({ error: 'Ocurrió un error al revertir la importación.' }, { status: 500 });
  }
}
