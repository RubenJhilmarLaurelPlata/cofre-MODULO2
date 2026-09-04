// src/app/api/configuracion/roles/route.ts
// Vista completa para la pantalla "Roles y permisos": el catalogo fijo
// (nombre/descripcion, src/lib/permisos.ts) cruzado con la asignacion
// real de cada rol (RolePermiso, en base de datos). Ya no es un Record
// hardcodeado — es la fuente de verdad editable via PUT
// /api/configuracion/roles/[role]/permisos.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso, CATALOGO_PERMISOS, GRUPOS_PERMISOS, getPermisosDeRol } from '@/lib/permisos';
import { ROLES, ROLE_LABELS } from '@/types';

export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.roles'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const porRol = Object.fromEntries(await Promise.all(ROLES.map(async (role) => [role, [...(await getPermisosDeRol(role))]] as const)));

  return NextResponse.json({
    grupos: GRUPOS_PERMISOS,
    permisos: CATALOGO_PERMISOS,
    roles: ROLES.map((role) => ({ role, label: ROLE_LABELS[role], permisos: porRol[role] })),
  });
}
