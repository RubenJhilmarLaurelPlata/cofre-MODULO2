// src/app/api/configuracion/feriados/importar/route.ts
// Importa varios feriados a la vez (una fecha,nombre por linea). Omite
// las fechas que ya existan en vez de fallar todo el lote.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  feriados: z
    .array(
      z.object({
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nombre: z.string().trim().min(1).max(120),
      })
    )
    .min(1)
    .max(500),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.feriados'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const existentes = new Set(
    (await prisma.holiday.findMany({ where: { fecha: { in: parsed.data.feriados.map((f) => f.fecha) } }, select: { fecha: true } })).map(
      (h) => h.fecha
    )
  );
  const nuevos = parsed.data.feriados.filter((f) => !existentes.has(f.fecha));

  if (nuevos.length > 0) {
    await prisma.holiday.createMany({ data: nuevos.map((f) => ({ fecha: f.fecha, nombre: f.nombre, activo: true })) });
  }

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'FERIADOS_IMPORTADOS',
    modulo: 'configuracion',
    valorNuevo: { importados: nuevos.length, omitidos: parsed.data.feriados.length - nuevos.length },
    ip,
    userAgent,
  });

  return NextResponse.json({ importados: nuevos.length, omitidos: parsed.data.feriados.length - nuevos.length });
}
