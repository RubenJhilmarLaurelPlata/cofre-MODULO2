// src/app/api/configuracion/usuarios/[id]/desbloquear/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { toUsuarioDTO } from '@/lib/usuarios';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const actualizado = await prisma.user.update({
    where: { id: params.id },
    data: { bloqueadoHasta: null, intentosFallidos: 0 },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_DESBLOQUEADO',
    modulo: 'usuarios',
    valorAnterior: { username: usuario.username },
    valorNuevo: { username: usuario.username },
    ip,
    userAgent,
  });

  return NextResponse.json(toUsuarioDTO(actualizado));
}
