// src/app/api/finanzas/gastos/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { resolverRangoFechas, MODOS_FECHA, type ModoFechaReporte } from '@/lib/reportes';
import { listarGastos, crearGasto } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const modoRaw = url.searchParams.get('modo') ?? 'mes';
  if (!MODOS_FECHA.includes(modoRaw as ModoFechaReporte)) {
    return NextResponse.json({ error: 'Modo de fecha inválido.' }, { status: 400 });
  }
  const { gte, lt } = resolverRangoFechas({
    modo: modoRaw as ModoFechaReporte,
    fecha: url.searchParams.get('fecha') ?? undefined,
    fechaInicio: url.searchParams.get('fechaInicio') ?? undefined,
    fechaFin: url.searchParams.get('fechaFin') ?? undefined,
  });

  const gastos = await listarGastos({ desde: gte, hasta: lt });
  return NextResponse.json(gastos);
}

const bodySchema = z.object({
  concepto: z.string().trim().min(1, 'El concepto no puede estar vacío').max(120),
  monto: z.number().finite().positive('El monto debe ser mayor a 0').max(1_000_000),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observaciones: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 });
  }

  const gasto = await crearGasto({
    concepto: parsed.data.concepto,
    monto: parsed.data.monto,
    fecha: parsed.data.fecha ? new Date(`${parsed.data.fecha}T12:00:00`) : undefined,
    observaciones: parsed.data.observaciones,
    userId: session.id,
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'GASTO_REGISTRADO',
    modulo: 'finanzas',
    valorNuevo: { concepto: gasto.concepto, monto: gasto.monto },
    ip,
    userAgent,
  });

  return NextResponse.json(gasto, { status: 201 });
}
