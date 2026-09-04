// src/app/api/envios/[id]/cancelar/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { cancelarEnvio, EnvioNoEncontradoError, EnvioNoModificableError } from '@/lib/envios';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.cancelar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const envio = await cancelarEnvio(params.id, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioNoModificableError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('Error cancelando envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al cancelar el envío.' }, { status: 500 });
  }
}
