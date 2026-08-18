// src/app/api/reportes/usuarios/route.ts
// Lista de usuarios activos, para el filtro "Usuario / Operador" de los reportes.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUsuariosParaFiltro } from '@/lib/reportes';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const usuarios = await getUsuariosParaFiltro();
  return NextResponse.json(usuarios);
}
