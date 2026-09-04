// src/app/api/envios/[id]/paquetes/[packageId]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import {
  quitarPaquete,
  actualizarPagoItem,
  EnvioNoEncontradoError,
  EnvioNoModificableError,
  ItemNoEditableError,
  PaqueteNoEnEsteEnvioError,
  MontoPagoRequeridoError,
} from '@/lib/envios';

export async function DELETE(_req: Request, { params }: { params: { id: string; packageId: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.quitar_paquete'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const envio = await quitarPaquete(params.id, params.packageId, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteNoEnEsteEnvioError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioNoModificableError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('Error quitando paquete del envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al quitar el paquete.' }, { status: 500 });
  }
}

const pagoSchema = z.object({
  estadoPago: z.enum(['PENDIENTE', 'PAGADO']),
  monto: z.number().positive().optional(),
});

/** Fase 3: corrige el pago de un paquete ya agregado, mientras el envío sigue en borrador. */
export async function PATCH(req: Request, { params }: { params: { id: string; packageId: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.agregar_paquete'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = pagoSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos de pago inválidos.' }, { status: 400 });
  }

  try {
    const envio = await actualizarPagoItem(params.id, params.packageId, parsed.data, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteNoEnEsteEnvioError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ItemNoEditableError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof MontoPagoRequeridoError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error actualizando pago del paquete:', err);
    return NextResponse.json({ error: 'Ocurrió un error al actualizar el pago.' }, { status: 500 });
  }
}
