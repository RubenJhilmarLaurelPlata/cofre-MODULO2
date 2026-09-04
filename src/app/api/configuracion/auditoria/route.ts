// src/app/api/configuracion/auditoria/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { buscarAuditoria } from '@/lib/auditoria';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.auditoria'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const resultados = await buscarAuditoria({
    q: url.searchParams.get('q')?.trim() || undefined,
    modulo: url.searchParams.get('modulo')?.trim() || undefined,
    accion: url.searchParams.get('accion')?.trim() || undefined,
    usuarioId: url.searchParams.get('usuarioId')?.trim() || undefined,
    desde: url.searchParams.get('desde') || undefined,
    hasta: url.searchParams.get('hasta') || undefined,
  });

  return NextResponse.json(resultados);
}
