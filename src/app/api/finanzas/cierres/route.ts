// src/app/api/finanzas/cierres/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { listarCierresCaja, realizarCierreCaja } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET() {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await listarCierresCaja());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const modoRaw = typeof json?.modo === 'string' ? json.modo : 'hoy';
  if (!MODOS_FECHA.includes(modoRaw as ModoFechaReporte)) {
    return NextResponse.json({ error: 'Modo de fecha inválido.' }, { status: 400 });
  }
  const { gte, lt, etiqueta } = resolverRangoFechas({
    modo: modoRaw as ModoFechaReporte,
    fecha: typeof json?.fecha === 'string' ? json.fecha : undefined,
    fechaInicio: typeof json?.fechaInicio === 'string' ? json.fechaInicio : undefined,
    fechaFin: typeof json?.fechaFin === 'string' ? json.fechaFin : undefined,
  });

  const cierre = await realizarCierreCaja(gte, lt, session.id);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'CIERRE_CAJA_REALIZADO',
    modulo: 'finanzas',
    valorNuevo: { periodo: etiqueta, resultadoNeto: cierre.resultadoNeto, ingresos: cierre.ingresos, gastos: cierre.gastos },
    ip,
    userAgent,
  });

  return NextResponse.json(cierre, { status: 201 });
}
