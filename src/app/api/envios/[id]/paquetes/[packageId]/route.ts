// src/app/api/envios/[id]/paquetes/[packageId]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import {
  quitarPaquete,
  actualizarPagoItem,
  actualizarDatosRecogidaItem,
  EnvioNoEncontradoError,
  EnvioNoModificableError,
  ItemNoEditableError,
  PaqueteNoEnEsteEnvioError,
  MontoPagoRequeridoError,
  type EnvioDetalleDTO,
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

// Fase 4: un solo PATCH acepta pago y/o datos de quien recogerá — pero
// cuando llega cualquiera de "destinatario"/"destinatarioTelefono", se
// tratan como el PAR completo (reemplazo total, no un merge parcial): el
// formulario de edición del cliente siempre envía ambos juntos con sus
// valores actuales, así que aquí nunca hay ambigüedad sobre "el campo que
// no vino, ¿se deja igual o se borra?" — ver actualizarDatosRecogidaItem().
const bodySchema = z
  .object({
    estadoPago: z.enum(['PENDIENTE', 'PAGADO']).optional(),
    monto: z.number().positive().optional(),
    destinatario: z.string().trim().max(120).optional(),
    destinatarioTelefono: z.string().trim().max(30).optional(),
  })
  .refine((v) => v.estadoPago !== undefined || v.destinatario !== undefined || v.destinatarioTelefono !== undefined, {
    message: 'No se envió ningún campo para actualizar.',
  });

/** Fase 3/4: corrige el pago y/o el destinatario original de un paquete ya agregado, mientras el envío sigue en borrador. */
export async function PATCH(req: Request, { params }: { params: { id: string; packageId: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.agregar_paquete'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  try {
    let envio: EnvioDetalleDTO | null = null;
    if (parsed.data.estadoPago !== undefined) {
      envio = await actualizarPagoItem(params.id, params.packageId, { estadoPago: parsed.data.estadoPago, monto: parsed.data.monto }, session.id);
    }
    if (parsed.data.destinatario !== undefined || parsed.data.destinatarioTelefono !== undefined) {
      envio = await actualizarDatosRecogidaItem(
        params.id,
        params.packageId,
        { destinatario: parsed.data.destinatario, destinatarioTelefono: parsed.data.destinatarioTelefono },
        session.id
      );
    }
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteNoEnEsteEnvioError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ItemNoEditableError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof MontoPagoRequeridoError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error actualizando el paquete del envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al actualizar el paquete.' }, { status: 500 });
  }
}
