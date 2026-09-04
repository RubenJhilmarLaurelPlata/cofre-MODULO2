// src/app/api/configuracion/empresa/route.ts
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
  return NextResponse.json(await getCompanyConfig());
}

const MAX_LOGO_BYTES = 500_000; // ~500KB en base64: suficiente para un logo, sin inflar demasiado la fila

const bodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
  logoUrl: z
    .string()
    .trim()
    // Solo formatos raster: excluye explicitamente data:image/svg+xml, que
    // puede llevar <script> embebido (aunque los navegadores ya no lo
    // ejecutan al cargarlo via <img>, mejor no depender de eso).
    .refine((v) => v === '' || /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v), 'El logo debe ser una imagen PNG, JPG, WEBP o GIF')
    .refine((v) => v.length <= MAX_LOGO_BYTES, 'El logo es demasiado grande (máximo ~500KB)')
    .optional(),
  direccion: z.string().trim().max(200).optional(),
  telefono: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Correo inválido').optional(),
  sitioWeb: z.string().trim().max(200).optional(),
  ciudad: z.string().trim().max(80).optional(),
  pais: z.string().trim().max(80).optional(),
  horarioAtencion: z.string().trim().max(120).optional(),
  moneda: z.string().trim().min(1).max(10),
  // Coordenadas para el clima del Dashboard (Paso A). Null/omitido = clima
  // no configurado, nunca se inventa un valor.
  climaLat: z.number().min(-90).max(90).nullable().optional(),
  climaLon: z.number().min(-180).max(180).nullable().optional(),

  // Identidad de esta instalacion (Fase 1 — multi-sucursal). Ciudad,
  // telefono y horario de atencion NO se repiten aqui: son los campos de
  // arriba (reutilizados tal cual, ver prisma/schema.prisma).
  sucursalCodigo: z.string().trim().max(10).optional(),
  sucursalNombre: z.string().trim().max(120).optional(),
  googleMapsUrl: z.string().trim().max(300).optional(),
  tiktokUrl: z.string().trim().max(300).optional(),
  whatsapp: z.string().trim().max(40).optional(),
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
  const actualizado = await prisma.company.update({
    where: { id: 1 },
    data: {
      nombre: parsed.data.nombre,
      logoUrl: parsed.data.logoUrl !== undefined ? (parsed.data.logoUrl || null) : undefined,
      direccion: parsed.data.direccion || null,
      telefono: parsed.data.telefono || null,
      email: parsed.data.email || null,
      sitioWeb: parsed.data.sitioWeb || null,
      ciudad: parsed.data.ciudad || null,
      pais: parsed.data.pais || null,
      horarioAtencion: parsed.data.horarioAtencion || null,
      moneda: parsed.data.moneda,
      ...(parsed.data.climaLat !== undefined ? { climaLat: parsed.data.climaLat } : {}),
      ...(parsed.data.climaLon !== undefined ? { climaLon: parsed.data.climaLon } : {}),
      ...(parsed.data.sucursalCodigo !== undefined ? { sucursalCodigo: parsed.data.sucursalCodigo || null } : {}),
      ...(parsed.data.sucursalNombre !== undefined ? { sucursalNombre: parsed.data.sucursalNombre || null } : {}),
      ...(parsed.data.googleMapsUrl !== undefined ? { googleMapsUrl: parsed.data.googleMapsUrl || null } : {}),
      ...(parsed.data.tiktokUrl !== undefined ? { tiktokUrl: parsed.data.tiktokUrl || null } : {}),
      ...(parsed.data.whatsapp !== undefined ? { whatsapp: parsed.data.whatsapp || null } : {}),
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'CONFIGURACION_EMPRESA_ACTUALIZADA',
    modulo: 'configuracion',
    valorAnterior: { nombre: anterior.nombre, moneda: anterior.moneda, direccion: anterior.direccion, telefono: anterior.telefono },
    valorNuevo: { nombre: actualizado.nombre, moneda: actualizado.moneda, direccion: actualizado.direccion, telefono: actualizado.telefono },
    ip,
    userAgent,
  });

  return NextResponse.json(actualizado);
}
