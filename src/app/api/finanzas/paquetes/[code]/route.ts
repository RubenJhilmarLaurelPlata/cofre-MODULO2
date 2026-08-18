// src/app/api/finanzas/paquetes/[code]/route.ts
// Detalle de un paquete + su historial de pagos (ledger), usado por la
// pantalla de Finanzas para corregir un cobro con contexto completo.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizarCodigo } from '@/lib/codigo';
import { getPackageDetail } from '@/lib/package-detail';
import { listarPagosPaquete } from '@/lib/finanzas';
import type { Role } from '@/types';

const ROLES_PERMITIDOS: Role[] = ['ADMIN', 'SUPERVISOR'];

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !ROLES_PERMITIDOS.includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const detalle = await getPackageDetail(params.code);
  if (!detalle) {
    return NextResponse.json({ error: `No se encontró ningún paquete con el código "${params.code.toUpperCase()}".` }, { status: 404 });
  }

  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(params.code) }, select: { id: true } });
  const pagos = pkg ? await listarPagosPaquete(pkg.id) : [];

  return NextResponse.json({ paquete: detalle, pagos });
}
