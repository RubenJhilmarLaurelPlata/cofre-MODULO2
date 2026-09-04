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
import { tienePermiso } from '@/lib/permisos';
import { getCompanyConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { canonicalizarSeparadores } from '@/lib/codigo';
import { entregaExcepcional, TransicionInvalidaError, SerieNoConfiguradaError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';
import { MOTIVOS_ENTREGA_EXCEPCIONAL, type Role } from '@/types';

// Exonerar un cobro (Bs0 deliberado) es mas sensible que la entrega
// excepcional en si — requiere ADMIN, no basta ADMIN_CAJA. Es una regla
// de negocio fija, no una dimension del catalogo de permisos.
const ROLES_EXONERACION: Role[] = ['ADMIN'];

// Entero, finito, positivo: nunca centavos, nunca negativo, y NUNCA Bs0
// por esta via (Bs0 solo entra por "exonerado", mas abajo, con su propio
// permiso y motivo obligatorio — ver especificacion, "Bs0 no debe poder
// utilizarse como monto normal").
const montoCobradoSchema = z.number().int('El monto no puede tener centavos.').finite().positive('El monto debe ser mayor a 0. Para entregar sin cobrar, usa la exoneración administrativa.');

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
    montoCobrado: montoCobradoSchema.optional(),
    motivoCobro: z.string().max(200).optional(),
    // Exoneracion administrativa explicita: Bs0 auditado, nunca "dejar el
    // campo vacío" (eso significa "cobrar automáticamente", ver
    // entregaExcepcional()). Excluyente con montoCobrado.
    exonerado: z.boolean().optional(),
    motivoExoneracion: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.motivoExcepcional !== 'OTRO' || !!v.motivoDetalle?.trim(), {
    message: 'Escribe el detalle del motivo cuando seleccionas "Otro".',
    path: ['motivoDetalle'],
  })
  .refine((v) => !v.exonerado || !v.montoCobrado, {
    message: 'No puedes exonerar el cobro y especificar un monto al mismo tiempo.',
    path: ['montoCobrado'],
  })
  .refine((v) => !v.exonerado || !!v.motivoExoneracion?.trim(), {
    message: 'La exoneración de cobro requiere un motivo.',
    path: ['motivoExoneracion'],
  });

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'entrega.excepcional'))) {
    return NextResponse.json({ error: 'No tienes permiso para realizar una entrega excepcional.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const opts = parsed.data;

  // No confiar solo en el HTML/frontend: el permiso de exoneracion se
  // vuelve a comprobar aqui, en el backend, independientemente de lo que
  // el cliente haya mostrado u ocultado.
  if (opts.exonerado && !ROLES_EXONERACION.includes(session.role)) {
    return NextResponse.json({ error: 'Solo un administrador puede exonerar un cobro.' }, { status: 403 });
  }

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
