// src/app/api/envios/[id]/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getEnvioDetalle, EnvioNoEncontradoError } from '@/lib/envios';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    // getEnvioDetalle() ya incluye "origen" (identidad de esta
    // instalación, Fase 1) — una sola fuente de verdad, ver envios.ts.
    const envio = await getEnvioDetalle(params.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('Error obteniendo detalle de envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al obtener el envío.' }, { status: 500 });
  }
}
