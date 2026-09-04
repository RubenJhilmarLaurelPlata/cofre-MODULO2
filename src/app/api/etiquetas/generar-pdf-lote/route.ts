// src/app/api/etiquetas/generar-pdf-lote/route.ts
// Pantalla "Etiquetas -> Generar PDF" (Fase 5): el administrador arma
// varias series (M 200, S 200, Q 120...) para uno o varios dias (Hoy /
// Mañana / Fecha específica / Semana completa / Rango — mismos 5 modos
// que la pestaña "Avanzado", ver calcularFechasLote) y obtiene, al final,
// un solo PDF con todo junto. Este endpoint no reinventa la generacion de
// codigos: por cada serie llama a generarLote() (misma funcion atomica
// de siempre, que ya reinicia el consecutivo en cada dia — ver ese
// comentario en src/lib/etiquetas.ts), en el orden en que el
// administrador las escribio, y devuelve los codigos de todas
// concatenados listos para pasarle tal cual a POST /api/etiquetas/pdf,
// que ya arma un unico PDF a partir de una lista de codigos sin importar
// de que serie/dia viene cada uno.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import {
  calcularFechasLote,
  construirCodigo,
  generarLote,
  getMonthLetters,
  MESES_LABELS,
  MAX_CANTIDAD_TOTAL,
  EtiquetasError,
  CodigosDuplicadosError,
  type LabelDescriptor,
} from '@/lib/etiquetas';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const serieSchema = z.object({
  inicial: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'La inicial es requerida')
    .max(4)
    .regex(/^[A-Z]+$/, 'La inicial solo puede tener letras'),
  // Cantidad POR DÍA (no total): si el trabajo cubre varios días (semana/
  // rango), cada día recibe esta misma cantidad, empezando siempre en el
  // mismo consecutivoInicial — ver "La numeración es por DÍA + SERIE" en
  // generarLote().
  cantidad: z.number().int().min(1).max(MAX_CANTIDAD_TOTAL),
  // Numero inicial explicito para CADA día del trabajo — si no se envía,
  // se usa 1 (un trabajo nuevo siempre empieza en 1 cada día, ver
  // especificación "el día siguiente reinicia en 1"). Antes esto se
  // completaba automáticamente con "último correlativo global de la
  // serie + 1", que tenía sentido cuando solo existía un día por trabajo,
  // pero mezclaba el consecutivo de OTRO día — ver auditoría, causa raíz
  // de "Semana completa" generando ~1000 etiquetas.
  consecutivoInicial: z.number().int().min(1).optional(),
});

const bodySchema = z
  .object({
    modo: z.enum(['hoy', 'manana', 'especifica', 'semana', 'rango']),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    series: z.array(serieSchema).min(1, 'Agrega al menos una serie').max(20, 'No se pueden combinar más de 20 series a la vez'),
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
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo el administrador puede generar etiquetas.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const { series } = parsed.data;

  const inicialesVistas = new Set<string>();
  for (const s of series) {
    if (inicialesVistas.has(s.inicial)) {
      return NextResponse.json({ error: `La serie "${s.inicial}" está repetida en la lista.` }, { status: 400 });
    }
    inicialesVistas.add(s.inicial);
  }

  try {
    const fechas = calcularFechasLote(
      parsed.data.modo === 'especifica'
        ? { modo: 'especifica', fecha: parsed.data.fecha! }
        : parsed.data.modo === 'semana'
          ? { modo: 'semana', fechaReferencia: parsed.data.fechaReferencia! }
          : parsed.data.modo === 'rango'
            ? { modo: 'rango', fechaInicio: parsed.data.fechaInicio!, fechaFin: parsed.data.fechaFin! }
            : { modo: parsed.data.modo }
    );

    // Cantidad total real: cada serie se repite una vez POR DÍA (ver
    // "Cantidad POR DÍA" en serieSchema) — antes esta pantalla solo
    // conocía un día, así que "cantidad" y "total" eran lo mismo.
    const totalSolicitado = series.reduce((acc, s) => acc + s.cantidad, 0) * fechas.length;
    if (totalSolicitado > MAX_CANTIDAD_TOTAL) {
      return NextResponse.json({ error: `No se pueden generar más de ${MAX_CANTIDAD_TOTAL} etiquetas en una sola operación.` }, { status: 400 });
    }

    const monthLetters = await getMonthLetters();
    const letraMesPorFecha = new Map<string, string>();
    for (const fecha of fechas) {
      const mes = Number(fecha.slice(5, 7));
      const letraMes = monthLetters[mes];
      if (!letraMes) {
        return NextResponse.json({ error: `No hay una letra configurada para el mes ${MESES_LABELS[mes - 1] ?? mes}.` }, { status: 400 });
      }
      letraMesPorFecha.set(fecha, letraMes);
    }

    const company = await getCompanyConfig();
    const separador = company.formatoSeparador;

    const existentes = await prisma.packageSeries.findMany({
      where: { inicial: { in: series.map((s) => s.inicial) } },
      select: { inicial: true },
    });
    const seriesExistentes = new Set(existentes.map((s) => s.inicial));

    // Pre-chequeo combinado: calcula, para cada serie y cada día, el rango
    // de consecutivos que le tocaría (siempre reiniciando en
    // consecutivoInicial en cada día — ver generarLote()) y verifica, en
    // una sola pasada, que ninguno de esos códigos exista ya, antes de
    // crear nada. generarLote() vuelve a verificar esto mismo por su
    // cuenta (es su propia garantía atómica), pero adelantar el chequeo
    // aquí evita crear la mitad del trabajo si una serie más adelante en
    // la lista iba a fallar por duplicados.
    const todosLosCodigos: string[] = [];
    for (const s of series) {
      const consecutivoInicial = s.consecutivoInicial ?? 1;
      for (const fecha of fechas) {
        const letraMes = letraMesPorFecha.get(fecha)!;
        for (let n = 0; n < s.cantidad; n++) {
          todosLosCodigos.push(construirCodigo(s.inicial, fecha, letraMes, separador, consecutivoInicial + n));
        }
      }
    }
    const [enGenerados, enPaquetes] = await Promise.all([
      prisma.generatedCode.findMany({ where: { code: { in: todosLosCodigos } }, select: { code: true } }),
      prisma.package.findMany({ where: { code: { in: todosLosCodigos } }, select: { code: true } }),
    ]);
    const conflictos = Array.from(new Set([...enGenerados.map((e) => e.code), ...enPaquetes.map((e) => e.code)]));
    if (conflictos.length > 0) {
      throw new CodigosDuplicadosError(conflictos);
    }

    const resultadosPorSerie: Array<{ inicial: string; batchId: string; primerConsecutivo: number; ultimoConsecutivo: number; codigos: LabelDescriptor[] }> = [];
    for (const s of series) {
      const resultado = await generarLote({
        inicial: s.inicial,
        descripcionNuevaSerie: !seriesExistentes.has(s.inicial) ? `Serie ${s.inicial}` : undefined,
        fechas,
        cantidadPorDia: s.cantidad,
        consecutivoInicial: s.consecutivoInicial ?? 1,
        separador,
        userId: session.id,
      });
      resultadosPorSerie.push({
        inicial: s.inicial,
        batchId: resultado.batchId,
        primerConsecutivo: resultado.primerConsecutivo,
        ultimoConsecutivo: resultado.ultimoConsecutivo,
        codigos: resultado.codigos,
      });
    }

    const codigosCombinados = resultadosPorSerie.flatMap((r) => r.codigos);

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'ETIQUETAS_GENERADAS',
      modulo: 'etiquetas',
      valorNuevo: {
        fechas,
        series: resultadosPorSerie.map((r) => ({ inicial: r.inicial, cantidad: r.codigos.length, primerConsecutivo: r.primerConsecutivo, ultimoConsecutivo: r.ultimoConsecutivo })),
        total: codigosCombinados.length,
      },
      ip,
      userAgent,
    });

    return NextResponse.json({ series: resultadosPorSerie, codigosCombinados, total: codigosCombinados.length });
  } catch (err) {
    if (err instanceof CodigosDuplicadosError) {
      return NextResponse.json({ error: err.message, codigos: err.codigos.slice(0, 20) }, { status: 409 });
    }
    if (err instanceof EtiquetasError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Error generando lote múltiple de etiquetas:', err);
    return NextResponse.json({ error: 'Ocurrió un error al generar las etiquetas.' }, { status: 500 });
  }
}
