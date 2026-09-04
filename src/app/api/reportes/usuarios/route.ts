// src/app/api/reportes/usuarios/route.ts
// Lista de usuarios activos, para el filtro "Usuario / Operador" de los reportes.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getUsuariosParaFiltro } from '@/lib/reportes';


export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'reportes.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const usuarios = await getUsuariosParaFiltro();
  return NextResponse.json(usuarios);
}
