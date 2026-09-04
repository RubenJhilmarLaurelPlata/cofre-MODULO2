// src/app/api/configuracion/usuarios/[id]/desactivar/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { toUsuarioDTO } from '@/lib/usuarios';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.usuarios'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  if (params.id === session.id) {
    return NextResponse.json({ error: 'No puedes desactivar tu propia cuenta.' }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const actualizado = await prisma.user.update({ where: { id: params.id }, data: { activo: false } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_DESACTIVADO',
    modulo: 'usuarios',
    valorAnterior: { username: usuario.username, activo: true },
    valorNuevo: { username: usuario.username, activo: false },
    ip,
    userAgent,
  });

  return NextResponse.json(toUsuarioDTO(actualizado));
}
