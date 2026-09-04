// src/app/api/etiquetas/generar/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getCompanyConfig } from '@/lib/config';
import { calcularFechasLote, generarLote, EtiquetasError, CodigosDuplicadosError } from '@/lib/etiquetas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z
  .object({
    inicial: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'La inicial es requerida')
      .max(4)
      .regex(/^[A-Z]+$/, 'La inicial solo puede tener letras'),
    descripcionNuevaSerie: z.string().trim().max(80).optional(),
    modo: z.enum(['hoy', 'manana', 'especifica', 'semana', 'rango']),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cantidadPorDia: z.number().int().min(1).max(5000),
    consecutivoInicial: z.number().int().min(1).max(9_999_999),
    observaciones: z.string().trim().max(300).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.modo === 'especifica' && !data.fecha) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Falta la fecha específica.', path: ['fecha'] });
    }
    if (data.modo === 'semana' && !data.fechaReferencia) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Falta la fecha de referencia de la semana.', path: ['fechaReferencia'] });
    }
    if (data.modo === 'rango' && (!data.fechaInicio || !data.fechaFin)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Falta la fecha de inicio o fin del rango.', path: ['fechaInicio'] });
    }
  });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'etiquetas.generar'))) {
    return NextResponse.json({ error: 'Solo el administrador puede generar lotes de etiquetas.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const fechas = calcularFechasLote(
      data.modo === 'especifica'
        ? { modo: 'especifica', fecha: data.fecha! }
        : data.modo === 'semana'
          ? { modo: 'semana', fechaReferencia: data.fechaReferencia! }
          : data.modo === 'rango'
            ? { modo: 'rango', fechaInicio: data.fechaInicio!, fechaFin: data.fechaFin! }
            : { modo: data.modo }
    );

    const company = await getCompanyConfig();

    const resultado = await generarLote({
      inicial: data.inicial,
      descripcionNuevaSerie: data.descripcionNuevaSerie,
      fechas,
      cantidadPorDia: data.cantidadPorDia,
      consecutivoInicial: data.consecutivoInicial,
      separador: company.formatoSeparador,
      observaciones: data.observaciones,
      userId: session.id,
    });

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'ETIQUETAS_GENERADAS',
      modulo: 'etiquetas',
      valorNuevo: { inicial: data.inicial, cantidad: resultado.codigos.length, primerConsecutivo: resultado.primerConsecutivo, ultimoConsecutivo: resultado.ultimoConsecutivo },
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
    console.error('Error generando lote de etiquetas:', err);
    return NextResponse.json({ error: 'Ocurrió un error al generar el lote.' }, { status: 500 });
  }
}
