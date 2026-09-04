// src/app/api/envios/[id]/paquetes/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getCompanyConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import {
  agregarPaquete,
  EnvioNoEncontradoError,
  EnvioNoModificableError,
  PaqueteNoEncontradoParaEnvioError,
  PaqueteNoElegibleError,
  PaqueteYaReservadoError,
  MontoPagoRequeridoError,
} from '@/lib/envios';
import { CodigoInvalidoError, SerieNoConfiguradaError } from '@/lib/paquete-registro';

const bodySchema = z.object({
  code: z.string().trim().min(1, 'El código no puede estar vacío').max(40),
  // Datos opcionales de quien recogerá (Fase 2.1): mismos límites que
  // Recepción usa para los mismos campos (ver recepcion/scan/route.ts).
  // Solo se aplican si el código todavía no existe como paquete — ver
  // agregarPaquete() en src/lib/envios.ts.
  destinatario: z.string().trim().max(120).optional(),
  destinatarioTelefono: z.string().trim().max(30).optional(),
  // Pago cobrado en origen para el destino (Fase 3): "monto" es un
  // efectivo libre, nunca un cálculo de tarifa — ver validarPago() en
  // src/lib/envios.ts.
  estadoPago: z.enum(['PENDIENTE', 'PAGADO']).optional(),
  monto: z.number().positive().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.agregar_paquete'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Código inválido' }, { status: 400 });
  }

  try {
    // Fase 2.1: si el código todavía no existe como paquete, agregarPaquete()
    // lo registra en el acto (mismo alta mínima que Recepción) — para eso
    // necesita una sucursal, resuelta con el mismo criterio que Recepción
    // usa hoy (sesión -> instalación configurada -> primera sucursal activa).
    const company = await getCompanyConfig();
    const branchId = session.branchId ?? company.sucursalActualId ?? (await prisma.branch.findFirst({ where: { activo: true } }))?.id;

    const envio = await agregarPaquete(
      params.id,
      parsed.data.code,
      session.id,
      branchId,
      {
        destinatario: parsed.data.destinatario,
        destinatarioTelefono: parsed.data.destinatarioTelefono,
      },
      parsed.data.estadoPago ? { estadoPago: parsed.data.estadoPago, monto: parsed.data.monto } : undefined
    );
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteNoEncontradoParaEnvioError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioNoModificableError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PaqueteYaReservadoError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PaqueteNoElegibleError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof CodigoInvalidoError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SerieNoConfiguradaError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof MontoPagoRequeridoError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Este código ya fue registrado por otra operación. Intenta agregarlo de nuevo.' }, { status: 409 });
    }
    console.error('Error agregando paquete al envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al agregar el paquete.' }, { status: 500 });
  }
}
