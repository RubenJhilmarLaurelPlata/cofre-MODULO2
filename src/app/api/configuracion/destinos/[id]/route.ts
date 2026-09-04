// src/app/api/configuracion/destinos/[id]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  ciudad: z.string().trim().max(80).optional(),
  direccion: z.string().trim().max(200).optional(),
  activa: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.destinos'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await prisma.sucursalDestino.findUnique({ where: { id: params.id } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese destino.' }, { status: 404 });

  const actualizado = await prisma.sucursalDestino.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.nombre !== undefined ? { nombre: parsed.data.nombre } : {}),
      ...(parsed.data.ciudad !== undefined ? { ciudad: parsed.data.ciudad || null } : {}),
      ...(parsed.data.direccion !== undefined ? { direccion: parsed.data.direccion || null } : {}),
      ...(parsed.data.activa !== undefined ? { activa: parsed.data.activa } : {}),
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'DESTINO_ACTUALIZADO', modulo: 'envios', valorAnterior: anterior, valorNuevo: actualizado, ip, userAgent });

  return NextResponse.json(actualizado);
}
