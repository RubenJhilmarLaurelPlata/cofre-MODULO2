// src/app/api/envios/[id]/recibir/route.ts
// "Envíos → Recibir envío" (Fase 2.1): confirma la recepción de un envío
// CERRADO. Protección optimista contra recibirlo dos veces vive en
// recibirEnvio() (src/lib/envios.ts), mismo criterio que cerrar/cancelar.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { recibirEnvio, EnvioNoEncontradoError, EnvioNoRecibibleError } from '@/lib/envios';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'transferencias.recibir'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const envio = await recibirEnvio(params.id, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioNoRecibibleError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('Error recibiendo envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al recibir el envío.' }, { status: 500 });
  }
}
