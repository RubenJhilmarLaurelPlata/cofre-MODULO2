// src/app/api/entrega/[code]/reingresar/route.ts
// "Volver a ingresar" — corrige un paquete marcado ENTREGADO por error,
// devolviéndolo a EN_PAQUETERIA (ver reingresarPaquete() en
// package-transitions.ts para el porqué de cada detalle: nunca crea un
// registro nuevo, nunca toca "code" ni la fecha original de ingreso, y
// deja la entrega anterior intacta en el historial).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { reingresarPaquete, TransicionInvalidaError, PaqueteNoEncontradoError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';
import { conLoteImportacion } from '@/lib/entrega-lote';

const bodySchema = z.object({ motivo: z.string().trim().max(300).optional() });

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.reingresar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const motivo = parsed.success ? parsed.data.motivo : undefined;

  try {
    await reingresarPaquete(params.code, session.id, motivo);
    const detalle = await getPackageDetail(params.code);
    return NextResponse.json(detalle ? await conLoteImportacion(detalle.code, detalle) : detalle);
  } catch (err) {
    if (err instanceof PaqueteNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof TransicionInvalidaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error volviendo a ingresar paquete:', err);
    return NextResponse.json({ error: 'Ocurrió un error al volver a ingresar el paquete.' }, { status: 500 });
  }
}
