// src/app/api/etiquetas/mes-letras/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getMonthLetters, setMonthLetters } from '@/lib/etiquetas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'etiquetas.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await getMonthLetters());
}

const bodySchema = z.object({
  letras: z
    .array(
      z.object({
        mes: z.number().int().min(1).max(12),
        letra: z
          .string()
          .trim()
          .toUpperCase()
          .min(1, 'Cada mes necesita una letra')
          .max(2)
          .regex(/^[A-Z]+$/, 'Solo se permiten letras'),
      })
    )
    .length(12, 'Debes indicar la letra de los 12 meses'),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'etiquetas.configurar_meses'))) {
    return NextResponse.json({ error: 'Solo el administrador puede configurar la letra de los meses.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await getMonthLetters();
  const actualizado = await setMonthLetters(parsed.data.letras);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'LETRAS_MES_ACTUALIZADAS',
    modulo: 'etiquetas',
    valorAnterior: anterior,
    valorNuevo: actualizado,
    ip,
    userAgent,
  });

  return NextResponse.json(actualizado);
}
