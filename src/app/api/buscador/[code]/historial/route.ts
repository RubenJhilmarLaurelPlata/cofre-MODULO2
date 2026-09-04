// src/app/api/buscador/[code]/historial/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getPackageHistorial } from '@/lib/package-detail';

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'buscador.ver_historial'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const code = params.code.trim().toUpperCase();
  const historial = await getPackageHistorial(code);
  if (!historial) {
    return NextResponse.json({ error: `No se encontró ningún paquete con el código "${code}".` }, { status: 404 });
  }

  return NextResponse.json(historial);
}
