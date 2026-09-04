// src/app/api/configuracion/usuarios/[id]/bloquear/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { toUsuarioDTO } from '@/lib/usuarios';

// Bloqueo manual (a diferencia del automatico por intentos fallidos): sin fecha de vencimiento util, se marca muy en el futuro hasta que un admin lo desbloquee.
const BLOQUEO_MANUAL_HASTA = new Date('2999-12-31T00:00:00Z');

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.usuarios'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  if (params.id === session.id) {
    return NextResponse.json({ error: 'No puedes bloquear tu propia cuenta.' }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const actualizado = await prisma.user.update({ where: { id: params.id }, data: { bloqueadoHasta: BLOQUEO_MANUAL_HASTA } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_BLOQUEADO_MANUAL',
    modulo: 'usuarios',
    valorAnterior: { username: usuario.username },
    valorNuevo: { username: usuario.username, bloqueadoHasta: BLOQUEO_MANUAL_HASTA },
    ip,
    userAgent,
  });

  return NextResponse.json(toUsuarioDTO(actualizado));
}
