// src/app/api/configuracion/feriados/[id]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
  activo: z.boolean(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.feriados'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await prisma.holiday.findUnique({ where: { id: params.id } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese feriado.' }, { status: 404 });

  const actualizado = await prisma.holiday.update({ where: { id: params.id }, data: parsed.data });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'FERIADO_EDITADO',
    modulo: 'configuracion',
    valorAnterior: anterior,
    valorNuevo: actualizado,
    ip,
    userAgent,
  });

  return NextResponse.json(actualizado);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.feriados'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const anterior = await prisma.holiday.findUnique({ where: { id: params.id } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese feriado.' }, { status: 404 });

  await prisma.holiday.delete({ where: { id: params.id } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'FERIADO_ELIMINADO', modulo: 'configuracion', valorAnterior: anterior, ip, userAgent });

  return NextResponse.json({ ok: true });
}
