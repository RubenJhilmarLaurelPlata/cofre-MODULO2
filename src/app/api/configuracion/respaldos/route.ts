// src/app/api/configuracion/respaldos/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listarRespaldos, crearRespaldo } from '@/lib/respaldos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await listarRespaldos());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const respaldo = await crearRespaldo(session.id);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: respaldo.estado === 'COMPLETADO' ? 'RESPALDO_CREADO' : 'RESPALDO_ERROR',
    modulo: 'configuracion',
    valorNuevo: { nombreArchivo: respaldo.nombreArchivo, tamanioBytes: respaldo.tamanioBytes, estado: respaldo.estado },
    ip,
    userAgent,
  });

  if (respaldo.estado !== 'COMPLETADO') {
    return NextResponse.json({ error: 'No se pudo crear el respaldo. Revisa los registros del servidor.', respaldo }, { status: 500 });
  }

  return NextResponse.json(respaldo);
}
