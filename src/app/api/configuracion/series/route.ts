// src/app/api/configuracion/series/route.ts
// Los "tipos de codigo" son PackageSeries: la misma tabla que ya usan
// Recepcion (valida la inicial), Etiquetas (genera codigos) y Buscador.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  const series = await prisma.packageSeries.findMany({ orderBy: { inicial: 'asc' } });
  return NextResponse.json(series);
}

const bodySchema = z.object({
  inicial: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'La inicial es requerida')
    .max(4)
    .regex(/^[A-Z]+$/, 'La inicial solo puede tener letras'),
  descripcion: z.string().trim().min(1, 'La descripción es requerida').max(120),
  tarifaBaseOverride: z.number().min(0).max(1_000_000).nullable().optional(),
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

  const existente = await prisma.packageSeries.findUnique({ where: { inicial: parsed.data.inicial } });
  if (existente) {
    return NextResponse.json({ error: `Ya existe un tipo de código "${parsed.data.inicial}".` }, { status: 409 });
  }

  const nuevo = await prisma.packageSeries.create({
    data: {
      inicial: parsed.data.inicial,
      descripcion: parsed.data.descripcion,
      tarifaBaseOverride: parsed.data.tarifaBaseOverride ?? null,
      activo: true,
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'TIPO_CODIGO_CREADO', modulo: 'configuracion', valorNuevo: nuevo, ip, userAgent });

  return NextResponse.json(nuevo);
}
