// src/app/api/finanzas/paquetes/[code]/ajustar/route.ts
// Corrección de un cobro ya registrado (Administrador/Supervisor, desde
// Finanzas). Nunca sobrescribe el monto anterior: agrega un movimiento
// AJUSTE al ledger de Pago (ver src/lib/package-transitions.ts:registrarPago).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizarCodigo } from '@/lib/codigo';
import { ajustarCobroPaquete } from '@/lib/finanzas';
import { getPackageDetail } from '@/lib/package-detail';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

const bodySchema = z.object({
  montoDelta: z.number().finite().refine((v) => v !== 0, 'El ajuste no puede ser 0'),
  motivo: z.string().max(200).optional(),
});

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 });
  }

  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(params.code) } });
  if (!pkg) {
    return NextResponse.json({ error: `No se encontró ningún paquete con el código "${params.code.toUpperCase()}".` }, { status: 404 });
  }

  await ajustarCobroPaquete(pkg, parsed.data.montoDelta, session.id, parsed.data.motivo);
  return NextResponse.json(await getPackageDetail(pkg.code));
}
