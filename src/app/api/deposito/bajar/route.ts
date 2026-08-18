// src/app/api/deposito/bajar/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { bajarDeDeposito, TransicionInvalidaError, PaqueteNoEncontradoError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'ENTREGA', 'RECEPCION', 'ADMIN_CAJA'];

const bodySchema = z.object({
  code: z.string().trim().min(1, 'El código no puede estar vacío').max(40),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Código inválido' }, { status: 400 });
  }

  const code = parsed.data.code.toUpperCase();

  try {
    await bajarDeDeposito(code, session.id);
    return NextResponse.json(await getPackageDetail(code));
  } catch (err) {
    if (err instanceof PaqueteNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof TransicionInvalidaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error bajando paquete de depósito:', err);
    return NextResponse.json({ error: 'Ocurrió un error al bajar el paquete de depósito.' }, { status: 500 });
  }
}
