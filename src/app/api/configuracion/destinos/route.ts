// src/app/api/configuracion/destinos/route.ts
// Catalogo de sucursales/destinos a los que ESTA instalacion puede
// enviar paquetes (Fase 2). Nace vacio; lo administra un ADMIN. Ver
// prisma/schema.prisma (modelo SucursalDestino) para el porque no se
// usa Branch.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  // Cualquiera que pueda usar Envios necesita ver el catalogo de
  // destinos para el selector — no solo quien puede administrarlo.
  if (!session || !(await tienePermiso(session, 'envios.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const destinos = await prisma.sucursalDestino.findMany({ orderBy: { nombre: 'asc' } });
  return NextResponse.json(destinos);
}

const bodySchema = z.object({
  codigo: z.string().trim().min(1, 'El código es requerido').max(10).transform((v) => v.toUpperCase()),
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
  ciudad: z.string().trim().max(80).optional(),
  direccion: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'admin.destinos'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const existente = await prisma.sucursalDestino.findUnique({ where: { codigo: parsed.data.codigo } });
  if (existente) {
    return NextResponse.json({ error: `Ya existe un destino con el código "${parsed.data.codigo}".` }, { status: 409 });
  }

  const destino = await prisma.sucursalDestino.create({
    data: {
      codigo: parsed.data.codigo,
      nombre: parsed.data.nombre,
      ciudad: parsed.data.ciudad || null,
      direccion: parsed.data.direccion || null,
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({ userId: session.id, accion: 'DESTINO_CREADO', modulo: 'envios', valorNuevo: destino, ip, userAgent });

  return NextResponse.json(destino, { status: 201 });
}
