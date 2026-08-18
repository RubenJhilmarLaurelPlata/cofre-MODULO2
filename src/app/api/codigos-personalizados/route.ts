// src/app/api/codigos-personalizados/route.ts
// Genera codigos "personalizados" (excepcion administrativa, Paso B):
// prefijo + serie + rango + monto propio. Solo ADMIN.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { generarCodigosPersonalizados, EtiquetasError, CodigosDuplicadosError } from '@/lib/etiquetas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({
  prefijo: z.string().trim().toUpperCase().min(1, 'El prefijo es requerido').max(4).regex(/^[A-Z]+$/, 'El prefijo solo puede tener letras'),
  serieNumero: z.string().trim().toUpperCase().min(1, 'La serie es requerida').max(10).regex(/^[A-Z0-9]+$/, 'La serie solo puede tener letras y números'),
  descripcionNuevaSerie: z.string().trim().max(80).optional(),
  desde: z.number().int().min(1).max(999_999),
  hasta: z.number().int().min(1).max(999_999),
  monto: z.number().finite().min(0).max(1_000_000),
  // Fase 4B ("Nuevo lote" desde Recepcion) — opcionales, la pestana de
  // Etiquetas nunca los envia y el comportamiento ahi no cambia.
  diasIncluidos: z.number().int().min(0).max(3650).optional(),
  nombre: z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo el administrador puede generar códigos personalizados.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const company = await getCompanyConfig();

    const resultado = await generarCodigosPersonalizados({
      prefijo: data.prefijo,
      serieNumero: data.serieNumero,
      separador: company.formatoSeparador,
      desde: data.desde,
      hasta: data.hasta,
      monto: data.monto,
      descripcionNuevaSerie: data.descripcionNuevaSerie,
      userId: session.id,
      diasIncluidos: data.diasIncluidos,
      nombre: data.nombre,
    });

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'CODIGOS_PERSONALIZADOS_GENERADOS',
      modulo: 'etiquetas',
      valorNuevo: {
        prefijo: data.prefijo,
        serieNumero: data.serieNumero,
        cantidad: resultado.codigos.length,
        desde: data.desde,
        hasta: data.hasta,
        monto: data.monto,
        diasIncluidos: data.diasIncluidos,
        nombre: data.nombre,
      },
      ip,
      userAgent,
    });

    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof CodigosDuplicadosError) {
      return NextResponse.json({ error: err.message, codigos: err.codigos.slice(0, 20) }, { status: 409 });
    }
    if (err instanceof EtiquetasError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Error generando códigos personalizados:', err);
    return NextResponse.json({ error: 'Ocurrió un error al generar los códigos.' }, { status: 500 });
  }
}
