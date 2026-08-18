// src/app/api/configuracion/seguridad/route.ts
// Tiempos de sesion/inactividad e intentos de login: leidos por
// src/lib/auth.ts (signSession, getSession) y por la ruta de login en
// cada request, asi que un cambio aqui se aplica de inmediato a la
// siguiente sesion o intento de acceso.
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
    tiempoMaximoSesionMin: company.tiempoMaximoSesionMin,
    tiempoMaximoInactividadMin: company.tiempoMaximoInactividadMin,
    cerrarSesionAutomaticamente: company.cerrarSesionAutomaticamente,
    maxIntentosLogin: company.maxIntentosLogin,
    tiempoBloqueoMin: company.tiempoBloqueoMin,
  });
}

const bodySchema = z.object({
  tiempoMaximoSesionMin: z.number().int().min(5).max(43_200), // 5 min .. 30 dias
  tiempoMaximoInactividadMin: z.number().int().min(0).max(43_200), // 0 = deshabilitado
  cerrarSesionAutomaticamente: z.boolean(),
  maxIntentosLogin: z.number().int().min(1).max(50),
  tiempoBloqueoMin: z.number().int().min(1).max(1440),
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
    accion: 'SEGURIDAD_ACTUALIZADA',
    modulo: 'configuracion',
    valorAnterior: {
      tiempoMaximoSesionMin: anterior.tiempoMaximoSesionMin,
      tiempoMaximoInactividadMin: anterior.tiempoMaximoInactividadMin,
      cerrarSesionAutomaticamente: anterior.cerrarSesionAutomaticamente,
      maxIntentosLogin: anterior.maxIntentosLogin,
      tiempoBloqueoMin: anterior.tiempoBloqueoMin,
    },
    valorNuevo: parsed.data,
    ip,
    userAgent,
  });

  return NextResponse.json({
    tiempoMaximoSesionMin: actualizado.tiempoMaximoSesionMin,
    tiempoMaximoInactividadMin: actualizado.tiempoMaximoInactividadMin,
    cerrarSesionAutomaticamente: actualizado.cerrarSesionAutomaticamente,
    maxIntentosLogin: actualizado.maxIntentosLogin,
    tiempoBloqueoMin: actualizado.tiempoBloqueoMin,
  });
}
