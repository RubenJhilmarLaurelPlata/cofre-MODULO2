// src/app/api/configuracion/respaldos/[id]/descargar/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { obtenerArchivoRespaldo } from '@/lib/respaldos';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const archivo = await obtenerArchivoRespaldo(params.id);
  if (!archivo) {
    return NextResponse.json({ error: 'No se encontró ese respaldo.' }, { status: 404 });
  }

  return new NextResponse(archivo.buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${archivo.nombreArchivo}"`,
    },
  });
}
