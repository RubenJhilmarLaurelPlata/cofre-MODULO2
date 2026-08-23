// src/lib/etiquetas.ts
// Logica central del Modulo 5 (Etiquetas): formato del codigo, calculo de
// fechas del lote, letra del mes (configurable, nunca codificada), y la
// generacion atomica de un lote nuevo verificando siempre contra la base
// de datos real que ningun codigo se repita.

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { MESES_LABELS } from '@/lib/meses';
import { canonicalizarSeparadores } from '@/lib/codigo';

export { MESES_LABELS };

export const MAX_CANTIDAD_TOTAL = 5000;
export const MAX_DIAS_RANGO = 60;

export interface LabelDescriptor {
  code: string;
  fecha: string; // YYYY-MM-DD
}

/** Forma que viaja por las APIs de historial de lotes (GET /api/etiquetas/lotes y /lotes/[id]). */
export interface LoteDTO {
  id: string;
  inicial: string;
  fechaInicio: string;
  fechaFin: string;
  cantidadPorDia: number;
  cantidad: number;
  separador: string;
  primerConsecutivo: number;
  ultimoConsecutivo: number;
  observaciones: string;
  generadoPor: string;
  createdAt: string;
}

export interface LoteDetalleDTO extends LoteDTO {
  usados: number;
  codigos: Array<{ code: string; fecha: string; usado: boolean }>;
}

export class EtiquetasError extends Error {}

export class CodigosDuplicadosError extends EtiquetasError {
  constructor(public codigos: string[]) {
    super(
      `Ya existen ${codigos.length} de los códigos que se iban a generar (ej. ${codigos.slice(0, 5).join(', ')}${
        codigos.length > 5 ? '…' : ''
      }). Elige otro consecutivo inicial.`
    );
    this.name = 'CodigosDuplicadosError';
  }
}

function toDateOnlyStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(s: string): Date {
  const partes = s.split('-');
  const y = Number(partes[0]);
  const m = Number(partes[1]);
  const d = Number(partes[2]);
  return new Date(y, m - 1, d);
}

export type ModoFecha = 'hoy' | 'manana' | 'especifica' | 'semana' | 'rango';

export type ParametrosFecha =
  | { modo: 'hoy' }
  | { modo: 'manana' }
  | { modo: 'especifica'; fecha: string }
  | { modo: 'semana'; fechaReferencia: string }
  | { modo: 'rango'; fechaInicio: string; fechaFin: string };

/** Calcula la lista de fechas (YYYY-MM-DD) que corresponden a un lote, segun el modo elegido. */
export function calcularFechasLote(params: ParametrosFecha): string[] {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  switch (params.modo) {
    case 'hoy':
      return [toDateOnlyStr(hoy)];

    case 'manana': {
      const m = new Date(hoy);
      m.setDate(m.getDate() + 1);
      return [toDateOnlyStr(m)];
    }

    case 'especifica':
      return [params.fecha];

    case 'semana': {
      // Semana lunes -> sabado (domingo no es dia operativo, ver
      // pricing.ts), igual que Dashboard/Finanzas/Reportes — ver
      // inicioSemanaLunes() en dashboard-data.ts. Antes decia "domingo ->
      // sabado" (bug real corregido junto con el mismo calculo duplicado
      // en dashboard-data.ts/reportes.ts: con la formula vieja, generar
      // etiquetas de "la semana" un domingo cualquiera arrancaba esa
      // semana en el domingo mismo en vez del lunes correspondiente).
      const ref = parseDateOnly(params.fechaReferencia);
      const diasDesdeLunes = (ref.getDay() + 6) % 7;
      const inicioSemana = new Date(ref);
      inicioSemana.setDate(ref.getDate() - diasDesdeLunes);
      const dias: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(inicioSemana);
        d.setDate(inicioSemana.getDate() + i);
        dias.push(toDateOnlyStr(d));
      }
      return dias;
    }

    case 'rango': {
      const inicio = parseDateOnly(params.fechaInicio);
      const fin = parseDateOnly(params.fechaFin);
      if (fin < inicio) throw new EtiquetasError('La fecha "hasta" no puede ser anterior a la fecha "desde".');
      const dias: string[] = [];
      const cursor = new Date(inicio);
      while (cursor <= fin) {
        dias.push(toDateOnlyStr(cursor));
        cursor.setDate(cursor.getDate() + 1);
        if (dias.length > MAX_DIAS_RANGO) {
          throw new EtiquetasError(`El rango no puede superar ${MAX_DIAS_RANGO} días.`);
        }
      }
      return dias;
    }
  }
}

/** Letra configurada para cada mes (1 = enero .. 12 = diciembre). Editable por el administrador, nunca fija en el código. */
export async function getMonthLetters(): Promise<Record<number, string>> {
  const rows = await prisma.monthLetter.findMany();
  const map: Record<number, string> = {};
  rows.forEach((r) => {
    map[r.mes] = r.letra;
  });
  return map;
}

export async function setMonthLetters(letras: Array<{ mes: number; letra: string }>): Promise<Record<number, string>> {
  await prisma.$transaction(
    letras.map((l) =>
      prisma.monthLetter.upsert({
        where: { mes: l.mes },
        update: { letra: l.letra },
        create: { mes: l.mes, letra: l.letra },
      })
    )
  );
  return getMonthLetters();
}

/** Arma el codigo de una etiqueta: {inicial}{dia 2 digitos}{letra del mes}{separador}{consecutivo}. Ej: M24J-1. */
export function construirCodigo(inicial: string, fecha: string, letraMes: string, separador: string, consecutivo: number): string {
  const dia = fecha.slice(8, 10);
  return `${inicial}${dia}${letraMes}${separador}${consecutivo}`;
}

/** Separa un codigo ya generado en su prefijo (todo antes del consecutivo) y el numero de consecutivo. */
export function parseConsecutivo(code: string): { prefijo: string; consecutivo: number } | null {
  const m = code.match(/^(.*\D)(\d+)$/);
  if (!m) return null;
  return { prefijo: m[1] ?? '', consecutivo: Number(m[2] ?? '') };
}

export interface GenerarLoteParams {
  inicial: string;
  descripcionNuevaSerie?: string;
  fechas: string[];
  cantidadPorDia: number;
  consecutivoInicial: number;
  separador: string;
  observaciones?: string;
  userId: string;
}

export interface GenerarLoteResultado {
  batchId: string;
  codigos: LabelDescriptor[];
  primerConsecutivo: number;
  ultimoConsecutivo: number;
}

/** Genera un lote nuevo de etiquetas de forma atomica, verificando siempre contra la base de datos real que ningun codigo se repita. */
export async function generarLote(params: GenerarLoteParams): Promise<GenerarLoteResultado> {
  const { inicial, fechas, cantidadPorDia, consecutivoInicial, separador, userId } = params;

  if (fechas.length === 0) {
    throw new EtiquetasError('No se indicó ninguna fecha para el lote.');
  }
  if (fechas.length * cantidadPorDia > MAX_CANTIDAD_TOTAL) {
    throw new EtiquetasError(`No se pueden generar más de ${MAX_CANTIDAD_TOTAL} etiquetas en un solo lote.`);
  }

  const monthLetters = await getMonthLetters();

  const descriptores: LabelDescriptor[] = [];
  let consecutivo = consecutivoInicial;
  for (const fecha of fechas) {
    const mes = Number(fecha.slice(5, 7));
    const letraMes = monthLetters[mes];
    if (!letraMes) {
      throw new EtiquetasError(`No hay una letra configurada para el mes ${MESES_LABELS[mes - 1] ?? mes}.`);
    }
    for (let i = 0; i < cantidadPorDia; i++) {
      descriptores.push({ code: construirCodigo(inicial, fecha, letraMes, separador, consecutivo), fecha });
      consecutivo++;
    }
  }
  const ultimoConsecutivo = consecutivo - 1;
  const codes = descriptores.map((d) => d.code);

  const [enGenerados, enPaquetes] = await Promise.all([
    prisma.generatedCode.findMany({ where: { code: { in: codes } }, select: { code: true } }),
    prisma.package.findMany({ where: { code: { in: codes } }, select: { code: true } }),
  ]);
  const conflictos = Array.from(new Set([...enGenerados.map((e) => e.code), ...enPaquetes.map((e) => e.code)]));
  if (conflictos.length > 0) {
    throw new CodigosDuplicadosError(conflictos);
  }

  const batch = await prisma.$transaction(async (tx) => {
    const serie = await tx.packageSeries.upsert({
      where: { inicial },
      update: {},
      create: { inicial, descripcion: params.descripcionNuevaSerie?.trim() || `Serie ${inicial}`, correlativo: 0 },
    });

    const nuevoLote = await tx.labelBatch.create({
      data: {
        inicial,
        fechaInicio: fechas[0]!,
        fechaFin: fechas[fechas.length - 1]!,
        cantidadPorDia,
        cantidad: descriptores.length,
        separador,
        primerConsecutivo: consecutivoInicial,
        ultimoConsecutivo,
        observaciones: params.observaciones?.trim() || '',
        generadoPorId: userId,
      },
    });

    await tx.generatedCode.createMany({
      data: descriptores.map((d) => ({
        code: d.code,
        inicial,
        fechaGenerado: d.fecha,
        batchId: nuevoLote.id,
      })),
    });

    if (ultimoConsecutivo > serie.correlativo) {
      await tx.packageSeries.update({ where: { inicial }, data: { correlativo: ultimoConsecutivo } });
    }

    return nuevoLote;
  });

  return { batchId: batch.id, codigos: descriptores, primerConsecutivo: consecutivoInicial, ultimoConsecutivo };
}

export interface GenerarCodigosPersonalizadosParams {
  prefijo: string; // solo letras, ej. "Q"
  serieNumero: string; // ej. "16" — no necesariamente numerico, va pegado al prefijo
  separador: string;
  desde: number;
  hasta: number;
  monto: number;
  descripcionNuevaSerie?: string;
  userId: string;
  // Fase 4B ("Nuevo lote" desde Recepcion) — ambos opcionales, no usados
  // por el flujo de Etiquetas (siguen null ahi, comportamiento identico).
  diasIncluidos?: number;
  nombre?: string;
}

/**
 * Codigos "personalizados" (excepcion administrativa, Paso B): el
 * administrador define un prefijo + serie + rango + monto propio, ej.
 * Q16-1 .. Q16-100 a Bs 5 cada uno. Reutiliza exactamente la misma
 * infraestructura que un lote de Etiquetas normal (PackageSeries,
 * GeneratedCode, LabelBatch) para que conviva con los codigos M/S/L/X de
 * siempre: aparece en el Historial de lotes, se puede reimprimir y
 * generar su PDF con los mismos endpoints, y Recepcion lo reconoce sin
 * cambios. Lo unico distinto es que cada GeneratedCode lleva su propio
 * "tarifaOverride" (el monto elegido), en vez de depender de la tarifa de
 * la serie o de la empresa.
 */
export async function generarCodigosPersonalizados(params: GenerarCodigosPersonalizadosParams): Promise<GenerarLoteResultado> {
  const { prefijo, serieNumero, separador, desde, hasta, monto, userId, diasIncluidos, nombre } = params;

  if (!/^[A-Z]+$/.test(prefijo)) {
    throw new EtiquetasError('El prefijo solo puede tener letras (ej: Q).');
  }
  if (!/^[A-Z0-9]*$/.test(serieNumero)) {
    throw new EtiquetasError('La serie solo puede tener letras y números (ej: 16).');
  }
  if (hasta < desde) {
    throw new EtiquetasError('El número "hasta" no puede ser menor que "desde".');
  }
  const cantidad = hasta - desde + 1;
  if (cantidad > MAX_CANTIDAD_TOTAL) {
    throw new EtiquetasError(`No se pueden generar más de ${MAX_CANTIDAD_TOTAL} códigos personalizados de una vez.`);
  }
  if (monto < 0) {
    throw new EtiquetasError('El monto no puede ser negativo.');
  }
  if (diasIncluidos !== undefined && (!Number.isInteger(diasIncluidos) || diasIncluidos < 0)) {
    throw new EtiquetasError('Los días incluidos deben ser un número entero, cero o mayor.');
  }

  const hoy = toDateOnlyStr(new Date());
  const codes: string[] = [];
  for (let n = desde; n <= hasta; n++) {
    codes.push(`${prefijo}${serieNumero}${separador}${n}`);
  }

  const [enGenerados, enPaquetes] = await Promise.all([
    prisma.generatedCode.findMany({ where: { code: { in: codes } }, select: { code: true } }),
    prisma.package.findMany({ where: { code: { in: codes } }, select: { code: true } }),
  ]);
  const conflictos = Array.from(new Set([...enGenerados.map((e) => e.code), ...enPaquetes.map((e) => e.code)]));
  if (conflictos.length > 0) {
    throw new CodigosDuplicadosError(conflictos);
  }

  const batch = await prisma.$transaction(async (tx) => {
    await tx.packageSeries.upsert({
      where: { inicial: prefijo },
      update: {},
      create: { inicial: prefijo, descripcion: params.descripcionNuevaSerie?.trim() || `Serie ${prefijo} (personalizada)`, correlativo: 0 },
    });

    const nuevoLote = await tx.labelBatch.create({
      data: {
        inicial: prefijo,
        fechaInicio: hoy,
        fechaFin: hoy,
        cantidadPorDia: cantidad,
        cantidad,
        separador,
        primerConsecutivo: desde,
        ultimoConsecutivo: hasta,
        observaciones: `Código personalizado: serie ${serieNumero}, ${prefijo}${serieNumero}${separador}${desde}–${prefijo}${serieNumero}${separador}${hasta}, monto Bs ${monto.toFixed(2)}${
          diasIncluidos !== undefined ? `, ${diasIncluidos} días incluidos` : ''
        }`,
        nombre: nombre?.trim() || null,
        generadoPorId: userId,
      },
    });

    await tx.generatedCode.createMany({
      data: codes.map((code) => ({
        code,
        inicial: prefijo,
        fechaGenerado: hoy,
        batchId: nuevoLote.id,
        tarifaOverride: monto,
        diasIncluidosOverride: diasIncluidos ?? null,
      })),
    });

    return nuevoLote;
  });

  const codigos: LabelDescriptor[] = codes.map((code) => ({ code, fecha: hoy }));
  return { batchId: batch.id, codigos, primerConsecutivo: desde, ultimoConsecutivo: hasta };
}

export type SelectorReimpresion =
  | { tipo: 'lote'; batchId: string }
  | { tipo: 'codigos'; codigos: string[] }
  | { tipo: 'rango'; desde: string; hasta: string };

/** Busca etiquetas ya generadas para reimprimirlas, siempre leyendo de la base de datos real (nunca recrea codigos). Cada codigo resuelto aqui cuenta como una reimpresion (Reporte de Etiquetas, Modulo 6). */
export async function resolverCodigosReimpresion(selector: SelectorReimpresion): Promise<LabelDescriptor[]> {
  let rows: Array<{ code: string; fechaGenerado: string }>;

  if (selector.tipo === 'lote') {
    rows = await prisma.generatedCode.findMany({ where: { batchId: selector.batchId } });
  } else if (selector.tipo === 'codigos') {
    // canonicalizarSeparadores() antes de comparar: GeneratedCode.code
    // siempre se guarda con "-" (ver construirCodigo), asi que un codigo
    // tipeado/pegado a mano con otro separador equivalente (ej.
    // "M19A/29", ver src/lib/codigo.ts) nunca encontraria coincidencia
    // sin esto.
    const codigosNormalizados = selector.codigos
      .map((c) => canonicalizarSeparadores(c.trim()).toUpperCase())
      .filter(Boolean);
    rows = await prisma.generatedCode.findMany({ where: { code: { in: codigosNormalizados } } });
  } else {
    // tipo === 'rango'
    const desde = parseConsecutivo(canonicalizarSeparadores(selector.desde.trim()).toUpperCase());
    const hasta = parseConsecutivo(canonicalizarSeparadores(selector.hasta.trim()).toUpperCase());
    if (!desde || !hasta) {
      throw new EtiquetasError('No se pudo interpretar el rango de códigos indicado.');
    }
    if (desde.prefijo !== hasta.prefijo) {
      throw new EtiquetasError('El código "desde" y "hasta" deben tener el mismo prefijo (misma inicial, día y letra de mes).');
    }
    const [min, max] = desde.consecutivo <= hasta.consecutivo ? [desde.consecutivo, hasta.consecutivo] : [hasta.consecutivo, desde.consecutivo];
    if (max - min > MAX_CANTIDAD_TOTAL) {
      throw new EtiquetasError(`El rango no puede superar ${MAX_CANTIDAD_TOTAL} códigos.`);
    }
    const candidatos: string[] = [];
    for (let n = min; n <= max; n++) candidatos.push(`${desde.prefijo}${n}`);
    rows = await prisma.generatedCode.findMany({ where: { code: { in: candidatos } } });
  }

  if (rows.length > 0) {
    await prisma.generatedCode.updateMany({
      where: { code: { in: rows.map((r) => r.code) } },
      data: { vecesReimpreso: { increment: 1 } },
    });
  }

  return ordenarPorConsecutivo(rows.map((r) => ({ code: r.code, fecha: r.fechaGenerado })));
}

function ordenarPorConsecutivo(descriptores: LabelDescriptor[]): LabelDescriptor[] {
  return [...descriptores].sort((a, b) => {
    const pa = parseConsecutivo(a.code)?.consecutivo ?? 0;
    const pb = parseConsecutivo(b.code)?.consecutivo ?? 0;
    return pa - pb;
  });
}

export interface FiltrosLotes {
  q?: string;
  inicial?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
}

/** Busca lotes de etiquetas para el historial (Modulo 5) y para el Reporte de Etiquetas (Modulo 6). */
export async function buscarLotes(filtros: FiltrosLotes) {
  const where: Prisma.LabelBatchWhereInput = {};
  if (filtros.inicial) where.inicial = filtros.inicial;

  if (filtros.desde || filtros.hasta) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filtros.desde) createdAt.gte = new Date(`${filtros.desde}T00:00:00`);
    if (filtros.hasta) {
      const fin = new Date(`${filtros.hasta}T00:00:00`);
      fin.setDate(fin.getDate() + 1);
      createdAt.lt = fin;
    }
    where.createdAt = createdAt;
  }

  if (filtros.q) {
    where.OR = [
      { inicial: { contains: filtros.q } },
      { observaciones: { contains: filtros.q } },
      { generadoPor: { nombre: { contains: filtros.q } } },
    ];
  }

  const lotes = await prisma.labelBatch.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filtros.limit ?? 100,
    include: { generadoPor: { select: { nombre: true } } },
  });

  return lotes.map((l) => ({
    id: l.id,
    inicial: l.inicial,
    fechaInicio: l.fechaInicio,
    fechaFin: l.fechaFin,
    cantidadPorDia: l.cantidadPorDia,
    cantidad: l.cantidad,
    separador: l.separador,
    primerConsecutivo: l.primerConsecutivo,
    ultimoConsecutivo: l.ultimoConsecutivo,
    observaciones: l.observaciones,
    generadoPor: l.generadoPor?.nombre ?? 'Sistema',
    createdAt: l.createdAt.toISOString(),
  }));
}

export interface LoteActivoDTO {
  id: string;
  inicial: string;
  // Prefijo+serie completo tal como aparece en los codigos reales (ej.
  // "Q16"), distinto de "inicial" (solo "Q", que es lo unico que guarda
  // PackageSeries — la serie numerica vive dentro de cada codigo, nunca
  // en su propia columna). Se deriva parseando un codigo real del lote,
  // nunca se re-calcula "a mano".
  prefijoCompleto: string;
  nombre: string | null;
  separador: string;
  primerConsecutivo: number;
  ultimoConsecutivo: number;
  cantidad: number;
  usados: number;
  monto: number | null;
  diasIncluidos: number | null;
  createdAt: string;
}

/**
 * Lotes "personalizados" (creados con monto propio — via "Nuevo lote" de
 * Recepcion, Fase 4B, o via "Codigos personalizados" de Etiquetas) que
 * todavia tienen codigos sin usar. Alimenta el panel "Lote activo" de
 * Recepcion. Un lote normal de Etiquetas (M/S/L/X de uso diario, sin
 * tarifaOverride) nunca aparece aqui — no tiene sentido mostrarlo como
 * "lote activo" de Recepcion.
 */
export async function getLotesActivos(limit = 10): Promise<LoteActivoDTO[]> {
  const lotes = await prisma.labelBatch.findMany({
    where: { codigos: { some: { tarifaOverride: { not: null } } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { codigos: { select: { code: true, usado: true, tarifaOverride: true, diasIncluidosOverride: true } } },
  });

  return lotes
    .map((l) => {
      const primerCodigo = l.codigos[0]?.code;
      const parsed = primerCodigo ? parseConsecutivo(primerCodigo) : null;
      const prefijoConSeparador = parsed?.prefijo ?? `${l.inicial}${l.separador}`;
      const prefijoCompleto = prefijoConSeparador.endsWith(l.separador)
        ? prefijoConSeparador.slice(0, -l.separador.length)
        : prefijoConSeparador;
      return {
        id: l.id,
        inicial: l.inicial,
        prefijoCompleto,
        nombre: l.nombre,
        separador: l.separador,
        primerConsecutivo: l.primerConsecutivo,
        ultimoConsecutivo: l.ultimoConsecutivo,
        cantidad: l.cantidad,
        usados: l.codigos.filter((c) => c.usado).length,
        monto: l.codigos[0]?.tarifaOverride ?? null,
        diasIncluidos: l.codigos[0]?.diasIncluidosOverride ?? null,
        createdAt: l.createdAt.toISOString(),
      };
    })
    .filter((l) => l.usados < l.cantidad);
}
