// src/app/api/entrega/[code]/entregar/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { entregarPaquete, TransicionInvalidaError, PaqueteNoEncontradoError, PaqueteEnEnvioError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';
import { conLoteImportacion } from '@/lib/entrega-lote';

const bodySchema = z.object({
  observaciones: z.string().max(500).optional(),
  montoCobrado: z.number().finite().optional(),
  motivoCobro: z.string().max(200).optional(),
  destinatario: z.string().max(120).optional(),
  destinatarioTelefono: z.string().max(30).optional(),
  destinatarioObservaciones: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.entregar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const opts = parsed.success
    ? parsed.data
    : { observaciones: undefined, montoCobrado: undefined, motivoCobro: undefined, destinatario: undefined, destinatarioTelefono: undefined, destinatarioObservaciones: undefined };

  try {
    const code = params.code.trim().toUpperCase();
    await entregarPaquete(code, session.id, opts);
    const detalle = await getPackageDetail(code);
    return NextResponse.json(detalle ? await conLoteImportacion(detalle.code, detalle) : detalle);
  } catch (err) {
    if (err instanceof PaqueteNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteEnEnvioError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof TransicionInvalidaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error entregando paquete:', err);
    return NextResponse.json({ error: 'Ocurrió un error al registrar la entrega.' }, { status: 500 });
  }
}
