// src/app/api/envios/[id]/paquetes/[packageId]/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { quitarPaquete, EnvioNoEncontradoError, EnvioNoModificableError, PaqueteNoEnEsteEnvioError } from '@/lib/envios';

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
