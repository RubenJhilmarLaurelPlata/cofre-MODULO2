// src/app/api/envios/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { listarEnvios, crearEnvio, DestinoNoEncontradoError, DestinoInactivoError } from '@/lib/envios';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = new URL(req.url);
  const envios = await listarEnvios({
    estado: url.searchParams.get('estado')?.trim() || undefined,
    destinoId: url.searchParams.get('destinoId')?.trim() || undefined,
    q: url.searchParams.get('q')?.trim() || undefined,
  });
  return NextResponse.json(envios);
}

const bodySchema = z.object({
  destinoId: z.string().trim().min(1, 'Selecciona un destino.'),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'envios.crear'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  try {
    const envio = await crearEnvio(parsed.data.destinoId, session.id);
    return NextResponse.json(envio, { status: 201 });
  } catch (err) {
    if (err instanceof DestinoNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof DestinoInactivoError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error creando envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al crear el envío.' }, { status: 500 });
  }
}
