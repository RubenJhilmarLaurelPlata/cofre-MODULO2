// src/app/api/entrega/[code]/excepcional/route.ts
// "Entrega excepcional": crea + recibe + entrega un paquete que nunca
// paso por Recepcion, en un solo movimiento auditado (ver
// entregaExcepcional() en src/lib/package-transitions.ts para el porque
// de cada detalle). Roles autorizados: interseccion de quien puede
// recepcion Y entrega (ADMIN, ADMIN_CAJA) — reutiliza PERMISOS_POR_MODULO
// de src/types/index.ts, no es una dimension de permisos nueva.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { canonicalizarSeparadores } from '@/lib/codigo';
import { entregaExcepcional, TransicionInvalidaError, SerieNoConfiguradaError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';
import { MOTIVOS_ENTREGA_EXCEPCIONAL, type Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'ADMIN_CAJA'];

const bodySchema = z
  .object({
    // Opciones estructuradas, no texto libre (ver especificacion, "Motivo
    // de entrega excepcional" — el motivo es trazabilidad de por que se
    // omitio Recepcion, nunca una decision sobre si corresponde cobrar).
    motivoExcepcional: z.enum(MOTIVOS_ENTREGA_EXCEPCIONAL, { errorMap: () => ({ message: 'Selecciona un motivo válido.' }) }),
    // Solo obligatorio cuando motivoExcepcional==='OTRO' (validado abajo).
    motivoDetalle: z.string().trim().max(300).optional(),
    destinatario: z.string().max(120).optional(),
    destinatarioTelefono: z.string().max(30).optional(),
    destinatarioObservaciones: z.string().max(500).optional(),
    observaciones: z.string().max(500).optional(),
    montoCobrado: z.number().finite().optional(),
    motivoCobro: z.string().max(200).optional(),
  })
  .refine((v) => v.motivoExcepcional !== 'OTRO' || !!v.motivoDetalle?.trim(), {
    message: 'Escribe el detalle del motivo cuando seleccionas "Otro".',
    path: ['motivoDetalle'],
  });

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para realizar una entrega excepcional.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const opts = parsed.data;

  try {
    const company = await getCompanyConfig();
    const branchId = session.branchId ?? company.sucursalActualId ?? (await prisma.branch.findFirst({ where: { activo: true } }))?.id;
    if (!branchId) {
      return NextResponse.json({ error: 'No hay ninguna sucursal activa configurada.' }, { status: 400 });
    }

    const code = canonicalizarSeparadores(params.code.trim()).toUpperCase();
    const pkg = await entregaExcepcional(code, session.id, branchId, opts);
    const detalle = await getPackageDetail(pkg.code);
    return NextResponse.json(detalle);
  } catch (err) {
    if (err instanceof TransicionInvalidaError || err instanceof SerieNoConfiguradaError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Error en entrega excepcional:', err);
    return NextResponse.json({ error: 'Ocurrió un error al registrar la entrega excepcional.' }, { status: 500 });
  }
}
