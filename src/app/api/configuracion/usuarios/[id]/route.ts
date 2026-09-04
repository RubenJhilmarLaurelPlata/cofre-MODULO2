// src/app/api/configuracion/usuarios/[id]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { toUsuarioDTO } from '@/lib/usuarios';
import { ROLES } from '@/types';

const bodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
  role: z.enum(ROLES),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.usuarios'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await prisma.user.findUnique({ where: { id: params.id } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const actualizado = await prisma.user.update({
    where: { id: params.id },
    data: { nombre: parsed.data.nombre, role: parsed.data.role },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_EDITADO',
    modulo: 'usuarios',
    valorAnterior: { nombre: anterior.nombre, role: anterior.role },
    valorNuevo: { nombre: actualizado.nombre, role: actualizado.role },
    ip,
    userAgent,
  });

  return NextResponse.json(toUsuarioDTO(actualizado));
}
