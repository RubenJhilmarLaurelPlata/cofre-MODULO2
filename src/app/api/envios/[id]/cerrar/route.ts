// src/app/api/envios/[id]/cerrar/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { cerrarEnvio, EnvioNoEncontradoError, EnvioNoModificableError, EnvioVacioError } from '@/lib/envios';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.cerrar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const envio = await cerrarEnvio(params.id, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioVacioError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof EnvioNoModificableError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('Error cerrando envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al cerrar el envío.' }, { status: 500 });
  }
}
