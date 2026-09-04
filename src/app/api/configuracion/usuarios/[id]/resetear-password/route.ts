// src/app/api/configuracion/usuarios/[id]/resetear-password/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, hashPassword } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').max(200),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.usuarios'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({
    where: { id: params.id },
    data: { passwordHash, intentosFallidos: 0, bloqueadoHasta: null },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_PASSWORD_RESTABLECIDA',
    modulo: 'usuarios',
    valorNuevo: { username: usuario.username },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
