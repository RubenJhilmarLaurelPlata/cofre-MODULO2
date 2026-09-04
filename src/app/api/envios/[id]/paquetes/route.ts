// src/app/api/envios/[id]/paquetes/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import {
  agregarPaquete,
  EnvioNoEncontradoError,
  EnvioNoModificableError,
  PaqueteNoEncontradoParaEnvioError,
  PaqueteNoElegibleError,
  PaqueteYaReservadoError,
} from '@/lib/envios';

const bodySchema = z.object({
  code: z.string().trim().min(1, 'El código no puede estar vacío').max(40),
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
    const envio = await agregarPaquete(params.id, parsed.data.code, session.id);
    return NextResponse.json(envio);
  } catch (err) {
    if (err instanceof EnvioNoEncontradoError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PaqueteNoEncontradoParaEnvioError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof EnvioNoModificableError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PaqueteYaReservadoError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PaqueteNoElegibleError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Error agregando paquete al envío:', err);
    return NextResponse.json({ error: 'Ocurrió un error al agregar el paquete.' }, { status: 500 });
  }
}
