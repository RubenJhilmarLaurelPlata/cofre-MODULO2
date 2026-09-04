// src/app/api/configuracion/usuarios/[id]/permisos/route.ts
// "Personalizar permisos" de un usuario individual: excepciones sobre
// los permisos de su rol (permisosExtra/permisosRevocados en User — ver
// src/lib/permisos.ts). GET devuelve la vista PERMISO DEL ROL / EXTRA /
// REVOCADO / EFECTIVO para los 3 estados nunca queden ambiguos en la UI.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso, getPermisosEfectivos, CATALOGO_PERMISOS } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import type { Role } from '@/types';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.roles'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const usuario = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true, permisosExtra: true, permisosRevocados: true } });
  if (!usuario) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const efectivos = await getPermisosEfectivos({ ...usuario, role: usuario.role as Role });
  return NextResponse.json(efectivos);
}

const CLAVES_VALIDAS = new Set(CATALOGO_PERMISOS.map((p) => p.key));
const bodySchema = z.object({
  permisosExtra: z.array(z.string()).refine((arr) => arr.every((p) => CLAVES_VALIDAS.has(p))),
  permisosRevocados: z.array(z.string()).refine((arr) => arr.every((p) => CLAVES_VALIDAS.has(p))),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.roles'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  // No permitir configuraciones ambiguas: un mismo permiso no puede estar
  // agregado Y revocado al mismo tiempo para el mismo usuario.
  const solapados = parsed.data.permisosExtra.filter((p) => parsed.data.permisosRevocados.includes(p));
  if (solapados.length > 0) {
    return NextResponse.json({ error: `El permiso "${solapados[0]}" no puede estar agregado y revocado a la vez.` }, { status: 400 });
  }

  const anterior = await prisma.user.findUnique({ where: { id: params.id }, select: { permisosExtra: true, permisosRevocados: true, nombre: true } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese usuario.' }, { status: 404 });

  const actualizado = await prisma.user.update({
    where: { id: params.id },
    data: {
      permisosExtra: parsed.data.permisosExtra.length > 0 ? JSON.stringify(parsed.data.permisosExtra) : null,
      permisosRevocados: parsed.data.permisosRevocados.length > 0 ? JSON.stringify(parsed.data.permisosRevocados) : null,
    },
    select: { role: true, permisosExtra: true, permisosRevocados: true },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'USUARIO_PERMISOS_PERSONALIZADOS',
    modulo: 'roles',
    valorAnterior: { usuario: anterior.nombre, permisosExtra: anterior.permisosExtra, permisosRevocados: anterior.permisosRevocados },
    valorNuevo: { usuario: anterior.nombre, permisosExtra: parsed.data.permisosExtra, permisosRevocados: parsed.data.permisosRevocados },
    ip,
    userAgent,
  });

  const efectivos = await getPermisosEfectivos({ ...actualizado, role: actualizado.role as Role });
  return NextResponse.json(efectivos);
}
