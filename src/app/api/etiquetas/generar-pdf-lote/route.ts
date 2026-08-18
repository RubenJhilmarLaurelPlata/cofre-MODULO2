// src/app/api/etiquetas/generar-pdf-lote/route.ts
// Pantalla "Etiquetas -> Generar PDF" (Fase 5): el administrador arma
// varias series (M 200, S 200, Q 120...) con una unica fecha de ingreso y
// obtiene, al final, un solo PDF con todas juntas. Este endpoint no
// reinventa la generacion de codigos: por cada serie llama a
// generarLote() (misma funcion atomica que ya usa la pestaña "Generar" de
// siempre), en el orden en que el administrador las escribio, y devuelve
// los codigos de todas concatenados listos para pasarle tal cual a
// POST /api/etiquetas/pdf, que ya arma un unico PDF a partir de una lista
// de codigos sin importar de que serie viene cada uno.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import {
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
  cantidad: z.number().int().min(1).max(MAX_CANTIDAD_TOTAL),
});

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  series: z.array(serieSchema).min(1, 'Agrega al menos una serie').max(20, 'No se pueden combinar más de 20 series a la vez'),
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
  const { fecha, series } = parsed.data;

  const inicialesVistas = new Set<string>();
  for (const s of series) {
    if (inicialesVistas.has(s.inicial)) {
      return NextResponse.json({ error: `La serie "${s.inicial}" está repetida en la lista.` }, { status: 400 });
    }
    inicialesVistas.add(s.inicial);
  }

  const totalSolicitado = series.reduce((acc, s) => acc + s.cantidad, 0);
  if (totalSolicitado > MAX_CANTIDAD_TOTAL) {
    return NextResponse.json({ error: `No se pueden generar más de ${MAX_CANTIDAD_TOTAL} etiquetas en una sola operación.` }, { status: 400 });
  }

  try {
    const monthLetters = await getMonthLetters();
    const mes = Number(fecha.slice(5, 7));
    const letraMes = monthLetters[mes];
    if (!letraMes) {
      return NextResponse.json({ error: `No hay una letra configurada para el mes ${MESES_LABELS[mes - 1] ?? mes}.` }, { status: 400 });
    }

    const company = await getCompanyConfig();
    const separador = company.formatoSeparador;

    const existentes = await prisma.packageSeries.findMany({
      where: { inicial: { in: series.map((s) => s.inicial) } },
      select: { inicial: true, correlativo: true },
    });
    const correlativoPorInicial = new Map(existentes.map((s) => [s.inicial, s.correlativo]));

    // Pre-chequeo combinado: calcula el rango de consecutivos que le tocaria
    // a cada serie y verifica, en una sola pasada, que ninguno de esos
    // codigos exista ya — antes de crear nada. generarLote() vuelve a
    // verificar esto mismo por su cuenta (es su propia garantia atomica),
    // pero adelantar el chequeo aqui evita crear la mitad de las series si
    // otra mas adelante en la lista iba a fallar por duplicados.
    const planes = series.map((s) => {
      const consecutivoInicial = (correlativoPorInicial.get(s.inicial) ?? 0) + 1;
      const codigos: string[] = [];
      for (let n = 0; n < s.cantidad; n++) {
        codigos.push(construirCodigo(s.inicial, fecha, letraMes, separador, consecutivoInicial + n));
      }
      return { inicial: s.inicial, cantidad: s.cantidad, consecutivoInicial, codigos };
    });

    const todosLosCodigos = planes.flatMap((p) => p.codigos);
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
        descripcionNuevaSerie: !correlativoPorInicial.has(s.inicial) ? `Serie ${s.inicial}` : undefined,
        fechas: [fecha],
        cantidadPorDia: s.cantidad,
        consecutivoInicial: (correlativoPorInicial.get(s.inicial) ?? 0) + 1,
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
        fecha,
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
