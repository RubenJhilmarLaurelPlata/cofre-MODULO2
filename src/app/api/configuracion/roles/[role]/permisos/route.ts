// src/app/api/configuracion/roles/[role]/permisos/route.ts
// Reemplaza el set COMPLETO de permisos de un rol — esto es lo que hace
// que "Roles y permisos" sea realmente editable (antes mostraba
// PERMISOS_POR_MODULO, fijo en código; ahora persiste en RolePermiso y
// es efectivo de inmediato, sin redeploy — ver src/lib/permisos.ts).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso, CATALOGO_PERMISOS } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { ROLES, type Role } from '@/types';

const CLAVES_VALIDAS = new Set(CATALOGO_PERMISOS.map((p) => p.key));

const bodySchema = z.object({
  permisos: z.array(z.string()).refine((arr) => arr.every((p) => CLAVES_VALIDAS.has(p)), 'Hay una clave de permiso desconocida.'),
});

function esRoleValido(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

export async function PUT(req: Request, { params }: { params: { role: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.roles'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  if (!esRoleValido(params.role)) {
    return NextResponse.json({ error: 'Rol inválido.' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  // No permitir que ADMIN se quede sin "admin.roles": evita que un
  // administrador se bloquee a si mismo (y a cualquier otro admin) por
  // accidente, sin ninguna forma de revertirlo desde la UI.
  if (params.role === 'ADMIN' && !parsed.data.permisos.includes('admin.roles')) {
    return NextResponse.json({ error: 'El rol Administrador siempre debe conservar el permiso "Administrar roles y permisos".' }, { status: 400 });
  }

  const anterior = await prisma.rolePermiso.findMany({ where: { role: params.role }, select: { permiso: true } });

  await prisma.$transaction([
    prisma.rolePermiso.deleteMany({ where: { role: params.role } }),
    prisma.rolePermiso.createMany({ data: parsed.data.permisos.map((permiso) => ({ id: `${params.role}:${permiso}`, role: params.role, permiso })) }),
  ]);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'ROL_PERMISOS_ACTUALIZADOS',
    modulo: 'roles',
    valorAnterior: { role: params.role, permisos: anterior.map((a) => a.permiso) },
    valorNuevo: { role: params.role, permisos: parsed.data.permisos },
    ip,
    userAgent,
  });

  return NextResponse.json({ role: params.role, permisos: parsed.data.permisos });
}
