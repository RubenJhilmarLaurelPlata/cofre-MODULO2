// src/app/api/configuracion/series/[inicial]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción es requerida').max(120),
  // Entero, mismo criterio que tarifaBase en tarifas/route.ts: el costo
  // nunca debe generar centavos.
  tarifaBaseOverride: z.number().int().min(0).max(1_000_000).nullable().optional(),
  activo: z.boolean(),
});

export async function PATCH(req: Request, { params }: { params: { inicial: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const inicial = params.inicial.toUpperCase();
  const anterior = await prisma.packageSeries.findUnique({ where: { inicial } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese tipo de código.' }, { status: 404 });

  const actualizado = await prisma.packageSeries.update({
    where: { inicial },
    data: {
      descripcion: parsed.data.descripcion,
      tarifaBaseOverride: parsed.data.tarifaBaseOverride ?? null,
      activo: parsed.data.activo,
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'TIPO_CODIGO_EDITADO',
    modulo: 'configuracion',
    valorAnterior: anterior,
    valorNuevo: actualizado,
    ip,
    userAgent,
  });

  return NextResponse.json(actualizado);
}

export async function DELETE(req: Request, { params }: { params: { inicial: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const inicial = params.inicial.toUpperCase();
  const anterior = await prisma.packageSeries.findUnique({ where: { inicial } });
  if (!anterior) return NextResponse.json({ error: 'No se encontró ese tipo de código.' }, { status: 404 });

  const [paquetes, codigos] = await Promise.all([
    prisma.package.count({ where: { inicial } }),
    prisma.generatedCode.count({ where: { inicial } }),
  ]);
  if (paquetes > 0 || codigos > 0) {
    return NextResponse.json(
      { error: `No se puede eliminar "${inicial}": ya fue usado (${paquetes} paquete(s), ${codigos} código(s) generado(s)). Desactívalo en su lugar.` },
      { status: 409 }
    );
  }

  await prisma.packageSeries.delete({ where: { inicial } });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'TIPO_CODIGO_ELIMINADO', modulo: 'configuracion', valorAnterior: anterior, ip, userAgent });

  return NextResponse.json({ ok: true });
}
