// src/app/api/finanzas/caja/cerrar/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { cerrarCajaSesion } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

const bodySchema = z.object({
  efectivoDeclarado: z.number().finite().min(0).max(10_000_000).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  // cerrarCajaSesion() ya registra su propia auditoria (CIERRE_CAJA_MANUAL
  // / CIERRE_CAJA_AUTOMATICO, ver src/lib/finanzas.ts) — no se duplica aqui.
  try {
    const cierre = await cerrarCajaSesion(session.id, { automatico: false, efectivoDeclarado: parsed.data.efectivoDeclarado });
    return NextResponse.json(cierre, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'No se pudo cerrar la caja.' }, { status: 400 });
  }
}
