// src/app/api/paquetes/[code]/foto/route.ts
// Sirve la foto de un paquete (si tiene una) a cualquier usuario con
// sesion valida — no queda accesible por URL directa sin autenticar,
// igual que los respaldos (ver src/lib/respaldos.ts).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizarCodigo } from '@/lib/codigo';
import { leerFotoPaquete } from '@/lib/paquete-foto';

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const pkg = await prisma.package.findUnique({
    where: { codigoNormalizado: normalizarCodigo(params.code) },
    select: { fotoArchivo: true },
  });
  if (!pkg?.fotoArchivo) {
    return NextResponse.json({ error: 'Este paquete no tiene foto.' }, { status: 404 });
  }

  const foto = await leerFotoPaquete(pkg.fotoArchivo);
  if (!foto) {
    return NextResponse.json({ error: 'No se pudo leer la foto.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(foto.buffer), {
    headers: { 'Content-Type': foto.contentType, 'Cache-Control': 'private, max-age=3600' },
  });
}
