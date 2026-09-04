// src/app/api/entrega/[code]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getPackageDetail } from '@/lib/package-detail';
import { conLoteImportacion } from '@/lib/entrega-lote';
import { normalizarCodigo } from '@/lib/codigo';

function sinPermiso() {
  return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
}

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.buscar'))) return sinPermiso();

  const detalle = await getPackageDetail(params.code);
  if (!detalle) {
    return NextResponse.json({ error: `No se encontró ningún paquete con el código "${params.code.toUpperCase()}".` }, { status: 404 });
  }
  return NextResponse.json(await conLoteImportacion(detalle.code, detalle));
}

const patchSchema = z
  .object({
    observaciones: z.string().max(500).optional(),
    // Fase 4: "quién recoge" — nunca "destinatario" (ver comentario en
    // entregarPaquete(), src/lib/package-transitions.ts). Esta ruta
    // NUNCA debe volver a escribir Package.destinatario/
    // destinatarioTelefono — esos son el registro original de
    // Recepción/Envíos, de solo lectura desde Entrega.
    quienRecogeNombre: z.string().max(120).optional(),
    quienRecogeTelefono: z.string().max(30).optional(),
    destinatarioObservaciones: z.string().max(500).optional(),
  })
  .refine(
    (v) => v.observaciones !== undefined || v.quienRecogeNombre !== undefined || v.quienRecogeTelefono !== undefined || v.destinatarioObservaciones !== undefined,
    { message: 'No se envió ningún campo para actualizar.' }
  );

export async function PATCH(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.buscar'))) return sinPermiso();

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 });
  }

  // Busqueda siempre por codigoNormalizado (nunca por "code" crudo): un
  // codigo que llega con apostrofe/acento en vez de guion (ver
  // src/lib/codigo.ts) debe encontrar el mismo paquete igual que en
  // Entrega/Deposito (ver buscarOFallar en package-transitions.ts).
  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(params.code) } });
  if (!pkg) return NextResponse.json({ error: `No se encontró ningún paquete con el código "${params.code.trim().toUpperCase()}".` }, { status: 404 });

  const { observaciones, quienRecogeNombre, quienRecogeTelefono, destinatarioObservaciones } = parsed.data;
  await prisma.package.update({
    where: { code: pkg.code },
    data: {
      ...(observaciones !== undefined ? { observaciones } : {}),
      ...(quienRecogeNombre !== undefined ? { quienRecogeNombre } : {}),
      ...(quienRecogeTelefono !== undefined ? { quienRecogeTelefono } : {}),
      ...(destinatarioObservaciones !== undefined ? { destinatarioObservaciones } : {}),
    },
  });

  const detalle = await getPackageDetail(pkg.code);
  return NextResponse.json(detalle ? await conLoteImportacion(detalle.code, detalle) : detalle);
}
