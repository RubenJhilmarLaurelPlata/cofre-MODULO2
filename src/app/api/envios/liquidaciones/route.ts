// src/app/api/envios/liquidaciones/route.ts
// Fase 3: registrar/consultar la entrega física de fondos de otra
// sucursal — ver registrarLiquidacion()/listarLiquidaciones() en
// src/lib/envios.ts. No representa una transferencia bancaria: es la
// trazabilidad de una entrega de efectivo entre sucursales.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { registrarLiquidacion, listarLiquidaciones, DestinoNoEncontradoError, NoHayFondosPendientesError } from '@/lib/envios';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.ver_fondos'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const liquidaciones = await listarLiquidaciones(url.searchParams.get('destinoId')?.trim() || undefined);
  return NextResponse.json(liquidaciones);
}

const bodySchema = z.object({
  destinoId: z.string().trim().min(1, 'Selecciona un destino.'),
  notas: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.liquidar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  try {
    const liquidacion = await registrarLiquidacion(parsed.data.destinoId, session.id, parsed.data.notas);
    return NextResponse.json(liquidacion, { status: 201 });
  } catch (err) {
    if (err instanceof DestinoNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof NoHayFondosPendientesError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('Error registrando liquidación:', err);
    return NextResponse.json({ error: 'Ocurrió un error al registrar la liquidación.' }, { status: 500 });
  }
}
