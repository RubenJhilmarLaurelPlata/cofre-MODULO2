// src/app/api/etiquetas/reimprimir/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { resolverCodigosReimpresion, EtiquetasError } from '@/lib/etiquetas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.union([
  z.object({ tipo: z.literal('lote'), batchId: z.string().min(1) }),
  z.object({ tipo: z.literal('codigos'), codigos: z.array(z.string().trim().min(1)).min(1).max(5000) }),
  z.object({ tipo: z.literal('rango'), desde: z.string().trim().min(1), hasta: z.string().trim().min(1) }),
]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['ADMIN', 'RECEPCION'].includes(session.role)) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  try {
    const codigos = await resolverCodigosReimpresion(parsed.data);
    if (codigos.length === 0) {
      return NextResponse.json({ error: 'No se encontró ningún código que coincida.' }, { status: 404 });
    }

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'ETIQUETAS_REIMPRESAS',
      modulo: 'etiquetas',
      valorNuevo: { selector: parsed.data, cantidad: codigos.length },
      ip,
      userAgent,
    });

    return NextResponse.json({ codigos });
  } catch (err) {
    if (err instanceof EtiquetasError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Error resolviendo reimpresión de etiquetas:', err);
    return NextResponse.json({ error: 'Ocurrió un error al buscar los códigos.' }, { status: 500 });
  }
}
