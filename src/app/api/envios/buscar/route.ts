// src/app/api/envios/buscar/route.ts
// "Envíos → Recibir envío" (Fase 2.1): busca un envío por su código (lo
// que codifica el QR — ver src/app/api/envios/[id]/qr/route.ts) antes de
// confirmar la recepción. buscarEnvioParaRecibir() ya incluye "origen"
// (identidad de esta instalación, Fase 1) — una sola fuente de verdad,
// ver getEnvioDetalle() en src/lib/envios.ts.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { buscarEnvioParaRecibir } from '@/lib/envios';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'transferencias.escanear_qr'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const codigo = new URL(req.url).searchParams.get('codigo')?.trim();
  if (!codigo) {
    return NextResponse.json({ error: 'Falta el código del envío.' }, { status: 400 });
  }

  const envio = await buscarEnvioParaRecibir(codigo);
  if (!envio) {
    return NextResponse.json({ error: `No se encontró ningún envío con el código "${codigo}".` }, { status: 404 });
  }

  return NextResponse.json(envio);
}
