// src/app/api/configuracion/respaldos/oracle/route.ts
// Conecta Configuracion > Respaldos con el mecanismo REAL de backup ya
// funcionando en el servidor (script + Oracle Object Storage) — ver
// src/lib/backup-oracle.ts, que dispara/lee ese mecanismo sin
// reimplementarlo.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ejecutarBackupReal, listarRespaldosOracle } from '@/lib/backup-oracle';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  const resultado = await listarRespaldosOracle();
  return NextResponse.json(resultado);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const resultadoBackup = await ejecutarBackupReal();

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: resultadoBackup.ok ? 'RESPALDO_ORACLE_EJECUTADO' : 'RESPALDO_ORACLE_ERROR',
    modulo: 'configuracion',
    valorNuevo: { ok: resultadoBackup.ok, error: resultadoBackup.error },
    ip,
    userAgent,
  });

  if (!resultadoBackup.ok) {
    return NextResponse.json({ error: resultadoBackup.error ?? 'No se pudo ejecutar el respaldo.' }, { status: 500 });
  }

  const lista = await listarRespaldosOracle();
  return NextResponse.json({ ...lista, salida: resultadoBackup.salida });
}
