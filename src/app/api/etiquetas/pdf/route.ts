// src/app/api/etiquetas/pdf/route.ts
// Genera el PDF final a partir de una lista de codigos ya resueltos (por
// "generar" o por "reimprimir"). Vuelve a verificar contra la base de
// datos real que cada codigo exista antes de dibujarlo: nunca se imprime
// un codigo inventado por el cliente.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { construirPdfEtiquetas } from '@/lib/etiquetas-pdf';
import { MAX_CANTIDAD_TOTAL } from '@/lib/etiquetas';

const bodySchema = z.object({
  codigos: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .min(1)
    .max(MAX_CANTIDAD_TOTAL),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'etiquetas.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const solicitados = parsed.data.codigos;
  const existentes = await prisma.generatedCode.findMany({
    where: { code: { in: solicitados.map((c) => c.code) } },
    select: { code: true },
  });
  const existentesSet = new Set(existentes.map((e) => e.code));
  const validos = solicitados.filter((c) => existentesSet.has(c.code));

  if (validos.length === 0) {
    return NextResponse.json({ error: 'Ninguno de los códigos indicados existe en el sistema.' }, { status: 400 });
  }

  try {
    const pdfBytes = await construirPdfEtiquetas(validos);
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="etiquetas-cofre-express.pdf"',
      },
    });
  } catch (err) {
    console.error('Error generando PDF de etiquetas:', err);
    return NextResponse.json({ error: 'Ocurrió un error al generar el PDF.' }, { status: 500 });
  }
}
