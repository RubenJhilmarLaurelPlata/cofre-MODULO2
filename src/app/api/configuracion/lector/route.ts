// src/app/api/configuracion/lector/route.ts
// Configuracion del lector S700 (Paso V3): credenciales de Socket Mobile
// Capture JS. Nunca obligatorio — mientras esto no este configurado, el
// sistema sigue funcionando enteramente en modo HID (ver
// src/lib/scanner/hid-provider.ts).
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
    s700Habilitado: company.s700Habilitado,
    s700AppId: company.s700AppId ?? '',
    s700DeveloperId: company.s700DeveloperId ?? '',
    s700AppKey: company.s700AppKey ?? '',
  });
}

const bodySchema = z
  .object({
    s700Habilitado: z.boolean(),
    s700AppId: z.string().trim().max(200).optional(),
    s700DeveloperId: z.string().trim().max(200).optional(),
    s700AppKey: z.string().trim().max(500).optional(),
  })
  .refine((v) => !v.s700Habilitado || (v.s700AppId && v.s700DeveloperId && v.s700AppKey), {
    message: 'Para habilitar CaptureSDK completa AppId, DeveloperId y AppKey.',
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
      s700Habilitado: parsed.data.s700Habilitado,
      s700AppId: parsed.data.s700AppId || null,
      s700DeveloperId: parsed.data.s700DeveloperId || null,
      s700AppKey: parsed.data.s700AppKey || null,
    },
  });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'LECTOR_S700_ACTUALIZADO',
    modulo: 'configuracion',
    valorAnterior: { s700Habilitado: anterior.s700Habilitado },
    // Nunca se guarda el AppKey en el log de auditoria (es una credencial): solo si cambio o no.
    valorNuevo: { s700Habilitado: actualizado.s700Habilitado, credencialesConfiguradas: !!(actualizado.s700AppId && actualizado.s700AppKey) },
    ip,
    userAgent,
  });

  return NextResponse.json({
    s700Habilitado: actualizado.s700Habilitado,
    s700AppId: actualizado.s700AppId ?? '',
    s700DeveloperId: actualizado.s700DeveloperId ?? '',
    s700AppKey: actualizado.s700AppKey ?? '',
  });
}
