// src/app/api/entrega/[code]/enviar-deposito/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { enviarADeposito, TransicionInvalidaError, PaqueteNoEncontradoError, PaqueteEnEnvioError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';

export async function POST(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.enviar_deposito'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const code = params.code.trim().toUpperCase();
    await enviarADeposito(code, session.id);
    return NextResponse.json(await getPackageDetail(code));
  } catch (err) {
    if (err instanceof PaqueteNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteEnEnvioError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof TransicionInvalidaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error enviando paquete a depósito:', err);
    return NextResponse.json({ error: 'Ocurrió un error al enviar el paquete a depósito.' }, { status: 500 });
  }
}
