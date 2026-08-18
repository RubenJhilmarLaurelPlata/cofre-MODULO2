// src/app/api/entrega/[code]/solicitar-bajar/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { solicitarBajarDeposito, TransicionInvalidaError, PaqueteNoEncontradoError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';

export async function POST(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !['ADMIN', 'ENTREGA', 'ADMIN_CAJA'].includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  try {
    const code = params.code.trim().toUpperCase();
    await solicitarBajarDeposito(code, session.id);
    return NextResponse.json(await getPackageDetail(code));
  } catch (err) {
    if (err instanceof PaqueteNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof TransicionInvalidaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error solicitando bajar de depósito:', err);
    return NextResponse.json({ error: 'Ocurrió un error al procesar la solicitud.' }, { status: 500 });
  }
}
