// src/app/api/envios/[id]/qr/route.ts
// Imagen PNG del QR de un envío ya cerrado. Reutiliza bwip-js/node
// (misma dependencia ya usada para los códigos de barras de Etiquetas,
// ver src/lib/etiquetas-pdf.ts) — no se agrega ninguna librería nueva.
// El contenido del QR es únicamente el codigo del envio (ej.
// "ENV-20260904-001"): la sucursal destino todavía no puede escanearlo
// para nada (eso es una fase futura, sin comunicación entre servidores
// todavía) — hoy solo sirve para mostrarlo/imprimirlo.
import { NextResponse } from 'next/server';
import bwipjs from 'bwip-js/node';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.ver_qr'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const envio = await prisma.envio.findUnique({ where: { id: params.id }, select: { codigo: true, qrToken: true, estado: true } });
  if (!envio || !envio.qrToken || envio.estado !== 'CERRADO') {
    return NextResponse.json({ error: 'Este envío no tiene un QR generado.' }, { status: 404 });
  }

  const png = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: envio.codigo,
    scale: 6,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });

  return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
}
