// src/app/api/configuracion/preferencias/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  const company = await getCompanyConfig();
  return NextResponse.json({
    idioma: company.idioma,
    zonaHoraria: company.zonaHoraria,
    formatoFecha: company.formatoFecha,
    formatoHora: company.formatoHora,
    sonidosActivos: company.sonidosActivos,
  });
}

const bodySchema = z.object({
  idioma: z.enum(['es', 'en']),
  zonaHoraria: z.string().trim().min(1).max(60),
  formatoFecha: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  formatoHora: z.enum(['12h', '24h']),
  sonidosActivos: z.boolean(),
});

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await getCompanyConfig();
  const actualizado = await prisma.company.update({ where: { id: 1 }, data: parsed.data });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'PREFERENCIAS_ACTUALIZADAS',
    modulo: 'configuracion',
    valorAnterior: {
      idioma: anterior.idioma,
      zonaHoraria: anterior.zonaHoraria,
      formatoFecha: anterior.formatoFecha,
      formatoHora: anterior.formatoHora,
      sonidosActivos: anterior.sonidosActivos,
    },
    valorNuevo: parsed.data,
    ip,
    userAgent,
  });

  return NextResponse.json({
    idioma: actualizado.idioma,
    zonaHoraria: actualizado.zonaHoraria,
    formatoFecha: actualizado.formatoFecha,
    formatoHora: actualizado.formatoHora,
    sonidosActivos: actualizado.sonidosActivos,
  });
}
