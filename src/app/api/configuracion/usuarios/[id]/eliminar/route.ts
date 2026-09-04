// src/app/api/configuracion/usuarios/[id]/eliminar/route.ts
// "Eliminar" un usuario — deliberadamente DISTINTO de "Desactivar"
// (/desactivar): nunca hace un DELETE fisico (el usuario puede tener
// paquetes registrados, pagos, cierres de caja, auditoria — borrar la
// fila rompería esas relaciones y perdería trazabilidad real), solo
// marca eliminadoAt + activo:false. El chequeo de login ya existente
// (!user.activo) bloquea el acceso de inmediato, sin necesitar logica
// nueva ahí.
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
    return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta.' }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });
  if (usuario.eliminadoAt) return NextResponse.json({ error: 'Ese usuario ya fue eliminado.' }, { status: 400 });

  const ahora = new Date();
  const actualizado = await prisma.user.update({ where: { id: params.id }, data: { eliminadoAt: ahora, activo: false } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_ELIMINADO',
    modulo: 'usuarios',
    valorAnterior: { username: usuario.username, activo: usuario.activo },
    valorNuevo: { username: usuario.username, eliminadoAt: ahora.toISOString() },
    ip,
    userAgent,
  });

  return NextResponse.json(toUsuarioDTO(actualizado));
}
