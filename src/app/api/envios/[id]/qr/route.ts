// src/app/api/envios/[id]/qr/route.ts
// Imagen PNG del QR de un envío ya cerrado. Reutiliza bwip-js/node
// (misma dependencia ya usada para los códigos de barras de Etiquetas,
// ver src/lib/etiquetas-pdf.ts) — no se agrega ninguna librería nueva.
//
// Fase 3: el contenido del QR pasa a ser "{codigo}|{qrToken}" (antes solo
// el código visible) — ver buscarEnvioParaRecibir() en src/lib/envios.ts,
// la única función que lo resuelve. Un código visible por sí solo es fácil
// de adivinar/copiar; el token no es adivinable y se genera una sola vez
// al cerrar el envío, así que escanear el QR real es más seguro que
// escribir el código a mano (que sigue funcionando, como respaldo manual).
//
// Antes este endpoint solo servía la imagen si estado==='CERRADO' — pero
// envio-detalle-client.tsx la sigue mostrando también cuando estado ya es
// 'RECIBIDO' (mismo QR, el envío ya viajó). Eso hacía que el <img> se
// rompiera (404 en JSON, que el navegador no puede pintar) apenas alguien
// confirmaba la recepción y volvía a esta pantalla — el bug real detrás de
// "el QR aparece roto en el celular" para un envío ya recibido.
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
  if (!envio || !envio.qrToken || (envio.estado !== 'CERRADO' && envio.estado !== 'RECIBIDO')) {
    return NextResponse.json({ error: 'Este envío no tiene un QR generado.' }, { status: 404 });
  }

  const png = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: `${envio.codigo}|${envio.qrToken}`,
    scale: 6,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });

  return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
}
