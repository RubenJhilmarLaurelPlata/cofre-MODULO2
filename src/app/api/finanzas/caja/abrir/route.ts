// src/app/api/finanzas/caja/abrir/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { abrirCajaSesion } from '@/lib/finanzas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';


export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'finanzas.cerrar_caja'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const estado = await abrirCajaSesion(session.id);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'CAJA_ABIERTA', modulo: 'finanzas', valorNuevo: { sesionId: estado.sesionId }, ip, userAgent });

  return NextResponse.json(estado);
}
