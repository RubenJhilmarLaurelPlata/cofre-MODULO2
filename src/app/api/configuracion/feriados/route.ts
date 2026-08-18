// src/app/api/configuracion/feriados/route.ts
// Los feriados ya los usa pricing.ts (calcularCosto, via getHolidaySet en
// config.ts) para no contarlos como dia cobrable: cualquier cambio aqui
// se aplica de inmediato al siguiente calculo, sin tocar esa logica.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');

  const feriados = await prisma.holiday.findMany({
    where: {
      ...(q ? { nombre: { contains: q } } : {}),
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    },
    orderBy: { fecha: 'asc' },
  });
  return NextResponse.json(feriados);
}

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const existente = await prisma.holiday.findFirst({ where: { fecha: parsed.data.fecha } });
  if (existente) {
    return NextResponse.json({ error: 'Ya existe un feriado registrado en esa fecha.' }, { status: 409 });
  }

  const nuevo = await prisma.holiday.create({ data: { fecha: parsed.data.fecha, nombre: parsed.data.nombre, activo: true } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'FERIADO_AGREGADO', modulo: 'configuracion', valorNuevo: nuevo, ip, userAgent });

  return NextResponse.json(nuevo);
}
