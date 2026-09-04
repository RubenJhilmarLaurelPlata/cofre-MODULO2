// src/app/api/entrega/[code]/corregir/route.ts
// Correccion administrativa posterior a la entrega (Paso B): el monto
// cobrado, los datos de quien recogio o las observaciones pueden haberse
// registrado mal. Solo ADMIN. El monto NUNCA se sobrescribe en
// silencio — se reutiliza registrarPago(..., 'AJUSTE', ...), que deja el
// monto anterior, el nuevo y el motivo como una fila mas del historial de
// Pago (ver src/lib/package-transitions.ts). El resto de los campos se
// audita aparte en AuditLog.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { corregirCobroAbsoluto } from '@/lib/package-transitions';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { getPackageDetail } from '@/lib/package-detail';
import { conLoteImportacion } from '@/lib/entrega-lote';
import { normalizarCodigo } from '@/lib/codigo';

const bodySchema = z
  .object({
    montoCorregido: z.number().finite().min(0).max(1_000_000).optional(),
    motivo: z.string().trim().max(300).optional(),
    destinatario: z.string().trim().max(120).optional(),
    destinatarioTelefono: z.string().trim().max(30).optional(),
    destinatarioObservaciones: z.string().trim().max(500).optional(),
    observaciones: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.montoCorregido !== undefined ||
      v.destinatario !== undefined ||
      v.destinatarioTelefono !== undefined ||
      v.destinatarioObservaciones !== undefined ||
      v.observaciones !== undefined,
    { message: 'No se envió ningún campo para corregir.' }
  );

export async function PATCH(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.corregir'))) {
    return NextResponse.json({ error: 'Solo el administrador puede corregir datos después de la entrega.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 });
  }

  // Busqueda siempre por codigoNormalizado, igual criterio que
  // src/app/api/entrega/[code]/route.ts — ver ese archivo para el porque.
  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(params.code) } });
  if (!pkg) return NextResponse.json({ error: `No se encontró ningún paquete con el código "${params.code.trim().toUpperCase()}".` }, { status: 404 });
  const code = pkg.code;

  const { montoCorregido, motivo, destinatario, destinatarioTelefono, destinatarioObservaciones, observaciones } = parsed.data;
  const { ip, userAgent } = extraerContextoRequest(req);

  if (montoCorregido !== undefined) {
    await corregirCobroAbsoluto(code, montoCorregido, session.id, motivo || `Corrección manual del monto cobrado en ${code}`);
  }

  const camposDirectos = { destinatario, destinatarioTelefono, destinatarioObservaciones, observaciones };
  const hayCamposDirectos = Object.values(camposDirectos).some((v) => v !== undefined);
  if (hayCamposDirectos) {
    await prisma.package.update({
      where: { code },
      data: {
        ...(destinatario !== undefined ? { destinatario } : {}),
        ...(destinatarioTelefono !== undefined ? { destinatarioTelefono } : {}),
        ...(destinatarioObservaciones !== undefined ? { destinatarioObservaciones } : {}),
        ...(observaciones !== undefined ? { observaciones } : {}),
      },
    });
    await registrarAuditoria({
      userId: session.id,
      accion: 'PAQUETE_CORREGIDO',
      modulo: 'entrega',
      valorAnterior: {
        code,
        destinatario: pkg.destinatario,
        destinatarioTelefono: pkg.destinatarioTelefono,
        destinatarioObservaciones: pkg.destinatarioObservaciones,
        observaciones: pkg.observaciones,
      },
      valorNuevo: { code, ...camposDirectos, motivo: motivo || undefined },
      ip,
      userAgent,
    });
  }

  const detalle = await getPackageDetail(code);
  return NextResponse.json(detalle ? await conLoteImportacion(detalle.code, detalle) : detalle);
}
