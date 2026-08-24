// src/lib/finanzas.ts
// Finanzas (Paso 1): a diferencia de "cobradoHoy" en el Dashboard (que es
// una ESTIMACION de tarifa acumulada sobre paquetes entregados, ver
// src/lib/dashboard-data.ts), los ingresos aqui son el LIBRO real de
// dinero cobrado: la suma de los movimientos en Pago (anticipos, cobros
// en entrega y ajustes) que efectivamente ocurrieron en el periodo. Es la
// fuente de verdad para "cuanto dinero entro" y para el cierre de caja.
import { prisma } from '@/lib/prisma';
import { registrarPago } from '@/lib/package-transitions';
import { registrarAuditoria } from '@/lib/auditoria';
import { getCompanyConfig } from '@/lib/config';
import type { Prisma, Package } from '@prisma/client';

export interface RangoFecha {
  desde?: Date;
  hasta?: Date;
}

function whereRango(rango: RangoFecha): Prisma.DateTimeFilter | undefined {
  const filtro: Prisma.DateTimeFilter = {};
  if (rango.desde) filtro.gte = rango.desde;
  if (rango.hasta) filtro.lt = rango.hasta;
  return Object.keys(filtro).length > 0 ? filtro : undefined;
}

export interface ResumenFinanciero {
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
}

export async function getResumenFinanciero(rango: RangoFecha): Promise<ResumenFinanciero> {
  const createdAt = whereRango(rango);
  const [pagos, gastosAgg] = await Promise.all([
    prisma.pago.findMany({ where: createdAt ? { createdAt } : {}, select: { monto: true, tipo: true, packageId: true } }),
    prisma.gasto.aggregate({ where: createdAt ? { fecha: createdAt } : {}, _sum: { monto: true } }),
  ]);

  const ingresos = Math.round(pagos.reduce((acc, p) => acc + p.monto, 0) * 100) / 100;
  const ajustes = Math.round(pagos.filter((p) => p.tipo === 'AJUSTE').reduce((acc, p) => acc + p.monto, 0) * 100) / 100;
  const gastos = Math.round((gastosAgg._sum.monto ?? 0) * 100) / 100;
  const paquetesCobrados = new Set(pagos.map((p) => p.packageId)).size;

  return { ingresos, gastos, ajustes, resultadoNeto: Math.round((ingresos - gastos) * 100) / 100, paquetesCobrados };
}

export interface GastoDTO {
  id: string;
  concepto: string;
  monto: number;
  fecha: string;
  observaciones: string | null;
  usuario: string;
  createdAt: string;
}

function toGastoDTO(g: { id: string; concepto: string; monto: number; fecha: Date; observaciones: string | null; createdAt: Date; user: { nombre: string } | null }): GastoDTO {
  return {
    id: g.id,
    concepto: g.concepto,
    monto: g.monto,
    fecha: g.fecha.toISOString(),
    observaciones: g.observaciones,
    usuario: g.user?.nombre ?? 'Sistema',
    createdAt: g.createdAt.toISOString(),
  };
}

export async function listarGastos(rango: RangoFecha): Promise<GastoDTO[]> {
  const fecha = whereRango(rango);
  const gastos = await prisma.gasto.findMany({
    where: fecha ? { fecha } : {},
    orderBy: { fecha: 'desc' },
    take: 300,
    include: { user: { select: { nombre: true } } },
  });
  return gastos.map(toGastoDTO);
}

export async function crearGasto(data: { concepto: string; monto: number; fecha?: Date; observaciones?: string; userId: string }): Promise<GastoDTO> {
  const gasto = await prisma.gasto.create({
    data: {
      concepto: data.concepto,
      monto: data.monto,
      fecha: data.fecha ?? new Date(),
      observaciones: data.observaciones || null,
      userId: data.userId,
    },
    include: { user: { select: { nombre: true } } },
  });
  return toGastoDTO(gasto);
}

export interface CierreCajaDTO {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
  automatico: boolean;
  efectivoDeclarado: number | null;
  diferencia: number | null;
  estado: string;
  usuario: string;
  createdAt: string;
}

function toCierreCajaDTO(c: {
  id: string;
  fechaInicio: Date;
  fechaFin: Date;
  ingresos: number;
  gastos: number;
  ajustes: number;
  resultadoNeto: number;
  paquetesCobrados: number;
  automatico: boolean;
  efectivoDeclarado: number | null;
  diferencia: number | null;
  estado: string;
  createdAt: Date;
  user: { nombre: string } | null;
}): CierreCajaDTO {
  return {
    id: c.id,
    fechaInicio: c.fechaInicio.toISOString(),
    fechaFin: c.fechaFin.toISOString(),
    ingresos: c.ingresos,
    gastos: c.gastos,
    ajustes: c.ajustes,
    resultadoNeto: c.resultadoNeto,
    paquetesCobrados: c.paquetesCobrados,
    automatico: c.automatico,
    efectivoDeclarado: c.efectivoDeclarado,
    diferencia: c.diferencia,
    estado: c.estado,
    usuario: c.user?.nombre ?? 'Sistema',
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listarCierresCaja(): Promise<CierreCajaDTO[]> {
  const cierres = await prisma.cierreCaja.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { nombre: true } } },
  });
  return cierres.map(toCierreCajaDTO);
}

/** Congela ingresos/gastos/resultado neto del periodo [fechaInicio, fechaFin) en una fila que ya no se puede alterar silenciosamente (ver especificación, "Cierre de caja"). */
export async function realizarCierreCaja(fechaInicio: Date, fechaFin: Date, userId: string): Promise<CierreCajaDTO> {
  const resumen = await getResumenFinanciero({ desde: fechaInicio, hasta: fechaFin });
  const cierre = await prisma.cierreCaja.create({
    data: {
      fechaInicio,
      fechaFin,
      ingresos: resumen.ingresos,
      gastos: resumen.gastos,
      ajustes: resumen.ajustes,
      resultadoNeto: resumen.resultadoNeto,
      paquetesCobrados: resumen.paquetesCobrados,
      userId,
    },
    include: { user: { select: { nombre: true } } },
  });
  return toCierreCajaDTO(cierre);
}

// ---------------------------------------------------------------------
// Ciclo de caja: ABIERTA / CERRADA
// ---------------------------------------------------------------------
// Mientras existe una CajaSesion con cerradaAt=null, la caja esta
// "abierta". Gastos y pagos (registrarPago/crearGasto arriba) NUNCA
// dependen de este estado — nunca deben bloquearse por no haber una
// sesion abierta. getEstadoCajaActual() abre una de forma transparente si
// hace falta, precisamente para que nunca haga falta acordarse de
// apretar "Abrir caja" antes de poder trabajar.

export interface EstadoCajaDTO {
  sesionId: string;
  abiertaAt: string;
  abiertaPor: string;
  resumen: ResumenFinanciero;
}

async function crearSesionSiNoHay(userId: string | null): Promise<{ id: string; abiertaAt: Date; abiertoPor: { nombre: string } | null }> {
  const abierta = await prisma.cajaSesion.findFirst({
    where: { cerradaAt: null },
    orderBy: { abiertaAt: 'desc' },
    include: { abiertaPor: { select: { nombre: true } } },
  });
  if (abierta) {
    return { id: abierta.id, abiertaAt: abierta.abiertaAt, abiertoPor: abierta.abiertaPor };
  }
  const nueva = await prisma.cajaSesion.create({
    data: { abiertaPorId: userId },
    include: { abiertaPor: { select: { nombre: true } } },
  });
  return { id: nueva.id, abiertaAt: nueva.abiertaAt, abiertoPor: nueva.abiertaPor };
}

/** Estado actual de caja: siempre "abierta" desde el punto de vista del llamador — si no habia ninguna sesion, esta funcion crea una transparente. Nunca lanza, nunca bloquea. */
export async function getEstadoCajaActual(): Promise<EstadoCajaDTO> {
  const sesion = await crearSesionSiNoHay(null);
  const resumen = await getResumenFinanciero({ desde: sesion.abiertaAt, hasta: new Date() });
  return {
    sesionId: sesion.id,
    abiertaAt: sesion.abiertaAt.toISOString(),
    abiertaPor: sesion.abiertoPor?.nombre ?? 'Sistema',
    resumen,
  };
}

/** "Abrir caja" explicito: idempotente — si ya hay una sesion abierta, la devuelve tal cual (nunca crea una segunda). */
export async function abrirCajaSesion(userId: string): Promise<EstadoCajaDTO> {
  const yaAbierta = await prisma.cajaSesion.findFirst({ where: { cerradaAt: null } });
  if (!yaAbierta) {
    await prisma.cajaSesion.create({ data: { abiertaPorId: userId } });
  }
  return getEstadoCajaActual();
}

export interface CerrarCajaOpts {
  automatico: boolean;
  efectivoDeclarado?: number;
}

/**
 * Cierra la sesion de caja actualmente abierta (congela el periodo
 * [abiertaAt, ahora) en un CierreCaja, igual criterio que
 * realizarCierreCaja) y abre la siguiente de inmediato — la caja nunca
 * queda en un limbo "cerrada para siempre" esperando una accion manual.
 * userId=null identifica un cierre disparado por el sistema (cierre
 * automatico o la reapertura que sigue a cualquier cierre).
 */
export async function cerrarCajaSesion(userId: string | null, opts: CerrarCajaOpts): Promise<CierreCajaDTO> {
  const sesion = await prisma.cajaSesion.findFirst({ where: { cerradaAt: null }, orderBy: { abiertaAt: 'desc' } });
  if (!sesion) {
    throw new Error('No hay ninguna caja abierta para cerrar.');
  }

  const ahora = new Date();
  const resumen = await getResumenFinanciero({ desde: sesion.abiertaAt, hasta: ahora });
  const diferencia = opts.efectivoDeclarado !== undefined ? Math.round((opts.efectivoDeclarado - resumen.resultadoNeto) * 100) / 100 : null;

  const cierre = await prisma.$transaction(async (tx) => {
    const nuevoCierre = await tx.cierreCaja.create({
      data: {
        fechaInicio: sesion.abiertaAt,
        fechaFin: ahora,
        ingresos: resumen.ingresos,
        gastos: resumen.gastos,
        ajustes: resumen.ajustes,
        resultadoNeto: resumen.resultadoNeto,
        paquetesCobrados: resumen.paquetesCobrados,
        automatico: opts.automatico,
        efectivoDeclarado: opts.efectivoDeclarado ?? null,
        diferencia,
        estado: 'CONFIRMADO',
        userId,
      },
      include: { user: { select: { nombre: true } } },
    });
    await tx.cajaSesion.update({
      where: { id: sesion.id },
      data: { cerradaAt: ahora, cerradaPorId: userId, cierreCajaId: nuevoCierre.id },
    });
    // Continuidad: la siguiente sesion arranca de inmediato, sin usuario
    // (el cierre fue una accion deliberada de alguien; reabrir no lo es).
    await tx.cajaSesion.create({ data: { abiertaPorId: null } });
    return nuevoCierre;
  });

  await registrarAuditoria({
    userId: userId ?? undefined,
    accion: opts.automatico ? 'CIERRE_CAJA_AUTOMATICO' : 'CIERRE_CAJA_MANUAL',
    modulo: 'finanzas',
    valorNuevo: { resultadoNeto: resumen.resultadoNeto, ingresos: resumen.ingresos, gastos: resumen.gastos, efectivoDeclarado: opts.efectivoDeclarado, diferencia },
  });

  return toCierreCajaDTO(cierre);
}

/**
 * Verifica si corresponde un cierre automatico ahora mismo (hora local
 * del servidor, mismo criterio que el resto del sistema — ver
 * src/app/(app)/entrega/page.tsx, que tampoco convierte zona horaria).
 * Llamada periodicamente desde src/instrumentation.ts. Nunca lanza: un
 * fallo aqui no debe tumbar el proceso.
 */
export async function verificarCierreAutomatico(): Promise<void> {
  try {
    const company = await getCompanyConfig();
    if (!company.cierreAutomaticoHabilitado) return;

    const [horaCfg, minCfg] = company.horaCierreAutomatico.split(':').map(Number);
    if (horaCfg === undefined || minCfg === undefined || Number.isNaN(horaCfg) || Number.isNaN(minCfg)) return;

    const ahora = new Date();
    const umbral = new Date(ahora);
    umbral.setHours(horaCfg, minCfg, 0, 0);
    if (ahora < umbral) return;

    const sesion = await prisma.cajaSesion.findFirst({ where: { cerradaAt: null }, orderBy: { abiertaAt: 'desc' } });
    // Si la sesion abierta ya arranco DESPUES del umbral de hoy (ej. se
    // cerro automaticamente hace un rato y la siguiente sesion recien
    // esta empezando), no hay nada que cerrar todavia — evita reintentar
    // un cierre cada 60s para siempre una vez pasada la hora.
    if (!sesion || sesion.abiertaAt >= umbral) return;

    await cerrarCajaSesion(null, { automatico: true });
    console.log(`[caja] Cierre automático ejecutado a las ${ahora.toISOString()} (umbral configurado: ${company.horaCierreAutomatico}).`);
  } catch (err) {
    console.error('[caja] Error verificando cierre automático:', err);
  }
}

export interface PagoDTO {
  id: string;
  tipo: string;
  monto: number;
  montoAnterior: number | null;
  montoNuevo: number | null;
  motivo: string | null;
  usuario: string;
  createdAt: string;
}

function toPagoDTO(p: { id: string; tipo: string; monto: number; montoAnterior: number | null; montoNuevo: number | null; motivo: string | null; createdAt: Date; user: { nombre: string } | null }): PagoDTO {
  return {
    id: p.id,
    tipo: p.tipo,
    monto: p.monto,
    montoAnterior: p.montoAnterior,
    montoNuevo: p.montoNuevo,
    motivo: p.motivo,
    usuario: p.user?.nombre ?? 'Sistema',
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listarPagosPaquete(packageId: string): Promise<PagoDTO[]> {
  const pagos = await prisma.pago.findMany({
    where: { packageId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { nombre: true } } },
  });
  return pagos.map(toPagoDTO);
}

/** Corrección de un cobro desde Finanzas (Administrador): nunca sobrescribe el valor anterior, siempre agrega una fila de ajuste (ver registrarPago). */
export async function ajustarCobroPaquete(pkg: Package, montoDelta: number, userId: string, motivo?: string): Promise<Package> {
  return registrarPago(pkg, 'AJUSTE', montoDelta, userId, motivo);
}

// ---------------------------------------------------------------------
// Desglose: cada boliviano de un total de Finanzas debe poder rastrearse
// hasta un movimiento real de Pago (paquete, monto, fecha/hora, operador).
// ---------------------------------------------------------------------

// Clasificacion de cada movimiento, para no mezclar visualmente una
// entrega normal, una entrega excepcional, un anticipo o un ajuste (ver
// especificacion, seccion 3). Se deriva de datos que ya existen — nunca de
// una suposicion: tipo=COBRO_ENTREGA + Package.origenEntrega (el mismo
// campo que ya distingue una entrega excepcional real de una normal, ver
// entregaExcepcional() en package-transitions.ts).
export type ClasificacionMovimiento = 'ENTREGA_NORMAL' | 'ENTREGA_EXCEPCIONAL' | 'ENTREGA_IMPORTACION' | 'ANTICIPO' | 'AJUSTE';

export const CLASIFICACION_LABEL: Record<ClasificacionMovimiento, string> = {
  ENTREGA_NORMAL: 'Entrega normal',
  ENTREGA_EXCEPCIONAL: 'Entrega excepcional',
  ENTREGA_IMPORTACION: 'Entrega vía importación',
  ANTICIPO: 'Anticipo (paquete aún no entregado)',
  AJUSTE: 'Ajuste / corrección',
};

function clasificarMovimiento(tipo: string, origenEntrega: string | null): ClasificacionMovimiento {
  if (tipo === 'ANTICIPO') return 'ANTICIPO';
  if (tipo === 'AJUSTE') return 'AJUSTE';
  // tipo === 'COBRO_ENTREGA'
  if (origenEntrega === 'EXCEPCIONAL') return 'ENTREGA_EXCEPCIONAL';
  if (origenEntrega === 'IMPORTACION') return 'ENTREGA_IMPORTACION';
  return 'ENTREGA_NORMAL';
}

export interface PagoDetalleDTO {
  id: string;
  codigo: string;
  tipo: string;
  clasificacion: ClasificacionMovimiento;
  clasificacionLabel: string;
  monto: number;
  usuario: string;
  createdAt: string;
  motivo: string | null;
  estadoPaquete: string;
  ingresoAt: string;
  entregaAt: string | null;
  // Flags honestas (seccion 1.H/I/J de la especificacion) — nunca se
  // asume "Pago = entrega": el modelo permite anticipos y ajustes sobre
  // paquetes en cualquier estado y en cualquier fecha.
  pagoSinEntregar: boolean;
  fechaPagoDistintaIngreso: boolean;
  fechaPagoDistintaEntrega: boolean;
}

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Lista, uno por uno, los movimientos de Pago que componen getResumenFinanciero() para el mismo período — el detalle detrás de "Ingresos", clasificado (entrega normal/excepcional/vía importación, anticipo o ajuste) para no mezclar situaciones distintas. */
export async function listarPagosPeriodo(rango: RangoFecha): Promise<PagoDetalleDTO[]> {
  const createdAt = whereRango(rango);
  const pagos = await prisma.pago.findMany({
    where: createdAt ? { createdAt } : {},
    orderBy: { createdAt: 'desc' },
    take: 2000,
    include: { user: { select: { nombre: true } }, package: { select: { code: true, origenEntrega: true, status: true, ingresoAt: true, entregaAt: true } } },
  });
  return pagos.map((p) => {
    const clasificacion = clasificarMovimiento(p.tipo, p.package.origenEntrega);
    return {
      id: p.id,
      codigo: p.package.code,
      tipo: p.tipo,
      clasificacion,
      clasificacionLabel: CLASIFICACION_LABEL[clasificacion],
      monto: p.monto,
      usuario: p.user?.nombre ?? 'Sistema',
      createdAt: p.createdAt.toISOString(),
      motivo: p.motivo,
      ingresoAt: p.package.ingresoAt.toISOString(),
      entregaAt: p.package.entregaAt ? p.package.entregaAt.toISOString() : null,
      pagoSinEntregar: p.package.status !== 'ENTREGADO',
      fechaPagoDistintaIngreso: !mismoDia(p.createdAt, p.package.ingresoAt),
      fechaPagoDistintaEntrega: p.package.entregaAt ? !mismoDia(p.createdAt, p.package.entregaAt) : true,
      estadoPaquete: p.package.status,
    };
  });
}

// ---------------------------------------------------------------------
// Reconciliacion: responde exactamente "de que se componen los N paquetes
// cobrados" cuando no coincide con "M entregados" — sin asumir la causa,
// desglosandola en las categorias reales que existen en el schema (ver
// especificacion, seccion 5). Los "cobros sin entrega" son la explicacion
// mas probable de una diferencia real: un anticipo pagado en el periodo
// para un paquete que se entrega (y por lo tanto factura su
// COBRO_ENTREGA) en OTRO periodo, o un ajuste sobre una entrega de otro
// dia — ninguno de los dos es un error, son movimientos financieros reales
// que ocurrieron en fechas distintas a las de la entrega.
// ---------------------------------------------------------------------

export interface ReconciliacionDTO {
  entregas: { normales: number; excepcionales: number; importacion: number; total: number };
  cobros: {
    cobrosEntrega: number;
    montoCobrosEntrega: number;
    anticipos: number;
    montoAnticipos: number;
    ajustes: number;
    montoAjustes: number;
    totalPaquetesCobrados: number;
    montoTotal: number;
  };
  diferencia: {
    cobrosAsociadosAEntrega: number;
    cobrosSinEntrega: number;
    anticipos: number;
    ajustes: number;
  };
}

export async function getReconciliacion(rango: RangoFecha): Promise<ReconciliacionDTO> {
  const fechaFiltro = whereRango(rango);

  const [entregasHist, pagos] = await Promise.all([
    prisma.packageHistory.findMany({
      where: { estado: 'ENTREGADO', ...(fechaFiltro ? { fecha: fechaFiltro } : {}) },
      select: { packageId: true, package: { select: { origenEntrega: true } } },
    }),
    prisma.pago.findMany({
      where: fechaFiltro ? { createdAt: fechaFiltro } : {},
      select: { packageId: true, tipo: true, monto: true },
    }),
  ]);

  let normales = 0;
  let excepcionales = 0;
  let importacion = 0;
  for (const h of entregasHist) {
    if (h.package.origenEntrega === 'EXCEPCIONAL') excepcionales++;
    else if (h.package.origenEntrega === 'IMPORTACION') importacion++;
    else normales++;
  }

  const cobroEntregaPkgIds = new Set(pagos.filter((p) => p.tipo === 'COBRO_ENTREGA').map((p) => p.packageId));
  let cobrosEntrega = 0;
  let montoCobrosEntrega = 0;
  let anticipos = 0;
  let montoAnticipos = 0;
  let ajustes = 0;
  let montoAjustes = 0;
  for (const p of pagos) {
    if (p.tipo === 'COBRO_ENTREGA') {
      cobrosEntrega++;
      montoCobrosEntrega += p.monto;
    } else if (p.tipo === 'ANTICIPO') {
      anticipos++;
      montoAnticipos += p.monto;
    } else if (p.tipo === 'AJUSTE') {
      ajustes++;
      montoAjustes += p.monto;
    }
  }

  const paquetesConPago = new Set(pagos.map((p) => p.packageId));
  const cobrosSinEntrega = Array.from(paquetesConPago).filter((id) => !cobroEntregaPkgIds.has(id)).length;
  const montoTotal = Math.round(pagos.reduce((acc, p) => acc + p.monto, 0) * 100) / 100;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    entregas: { normales, excepcionales, importacion, total: entregasHist.length },
    cobros: {
      cobrosEntrega,
      montoCobrosEntrega: r2(montoCobrosEntrega),
      anticipos,
      montoAnticipos: r2(montoAnticipos),
      ajustes,
      montoAjustes: r2(montoAjustes),
      totalPaquetesCobrados: paquetesConPago.size,
      montoTotal,
    },
    diferencia: {
      cobrosAsociadosAEntrega: cobroEntregaPkgIds.size,
      cobrosSinEntrega,
      anticipos,
      ajustes,
    },
  };
}

// ---------------------------------------------------------------------
// Reconciliacion DETALLADA: la comparacion de conjuntos que
// getReconciliacion() resume en numeros, aqui es por CODIGO — para poder
// responder, sin asumir nada, exactamente cuales paquetes explican una
// diferencia entre "entregados" y "cobrados" (ver especificacion, "Prueba
// especifica 47 vs 88": nunca aceptar "probablemente son anticipos" como
// respuesta, mostrar el conjunto real).
// ---------------------------------------------------------------------

export interface PaqueteReconciliadoDTO {
  codigo: string;
  status: string;
  origenEntrega: string | null;
  ingresoAt: string;
  entregaAt: string | null;
  movimientos: Array<{ tipo: string; clasificacionLabel: string; monto: number; createdAt: string; usuario: string }>;
}

export interface ReconciliacionDetalladaDTO {
  // Entregados en el periodo (por PackageHistory ENTREGADO) que NO tienen
  // ningun Pago en este mismo periodo.
  soloEntregados: PaqueteReconciliadoDTO[];
  // Tienen algun Pago en el periodo, pero NO fueron entregados en este
  // mismo periodo (la entrega fue otro dia, o el paquete aun no se
  // entrega) — este es el conjunto que explica, uno por uno, por que
  // "cobrados" puede superar a "entregados".
  soloCobrados: PaqueteReconciliadoDTO[];
  // Entregados Y con algun Pago, ambos en este mismo periodo.
  ambos: PaqueteReconciliadoDTO[];
}

export async function getReconciliacionDetallada(rango: RangoFecha): Promise<ReconciliacionDetalladaDTO> {
  const fechaFiltro = whereRango(rango);

  const [entregasHist, pagos] = await Promise.all([
    prisma.packageHistory.findMany({
      where: { estado: 'ENTREGADO', ...(fechaFiltro ? { fecha: fechaFiltro } : {}) },
      select: { packageId: true },
    }),
    prisma.pago.findMany({
      where: fechaFiltro ? { createdAt: fechaFiltro } : {},
      orderBy: { createdAt: 'asc' },
      select: {
        packageId: true,
        tipo: true,
        monto: true,
        createdAt: true,
        user: { select: { nombre: true } },
        package: { select: { code: true, status: true, origenEntrega: true, ingresoAt: true, entregaAt: true } },
      },
    }),
  ]);

  const entregadosIds = new Set(entregasHist.map((h) => h.packageId));
  const pagosPorPackage = new Map<string, typeof pagos>();
  for (const p of pagos) {
    const lista = pagosPorPackage.get(p.packageId) ?? [];
    lista.push(p);
    pagosPorPackage.set(p.packageId, lista);
  }

  function aDTO(packageId: string): PaqueteReconciliadoDTO {
    const lista = pagosPorPackage.get(packageId) ?? [];
    const primero = lista[0];
    const pkg = primero?.package;
    return {
      codigo: pkg?.code ?? packageId,
      status: pkg?.status ?? '—',
      origenEntrega: pkg?.origenEntrega ?? null,
      ingresoAt: pkg?.ingresoAt.toISOString() ?? '',
      entregaAt: pkg?.entregaAt ? pkg.entregaAt.toISOString() : null,
      movimientos: lista.map((p) => ({
        tipo: p.tipo,
        clasificacionLabel: CLASIFICACION_LABEL[clasificarMovimiento(p.tipo, p.package.origenEntrega)],
        monto: p.monto,
        createdAt: p.createdAt.toISOString(),
        usuario: p.user?.nombre ?? 'Sistema',
      })),
    };
  }

  const soloCobrados: PaqueteReconciliadoDTO[] = [];
  const ambos: PaqueteReconciliadoDTO[] = [];
  for (const packageId of pagosPorPackage.keys()) {
    (entregadosIds.has(packageId) ? ambos : soloCobrados).push(aDTO(packageId));
  }

  // "Solo entregados" no tiene movimientos de Pago que buscar en el mapa
  // anterior — se arma directamente desde el propio Package.
  const idsSoloEntregados = Array.from(entregadosIds).filter((id) => !pagosPorPackage.has(id));
  const paquetesSoloEntregados =
    idsSoloEntregados.length > 0
      ? await prisma.package.findMany({
          where: { id: { in: idsSoloEntregados } },
          select: { id: true, code: true, status: true, origenEntrega: true, ingresoAt: true, entregaAt: true },
        })
      : [];
  const soloEntregados: PaqueteReconciliadoDTO[] = paquetesSoloEntregados.map((pkg) => ({
    codigo: pkg.code,
    status: pkg.status,
    origenEntrega: pkg.origenEntrega,
    ingresoAt: pkg.ingresoAt.toISOString(),
    entregaAt: pkg.entregaAt ? pkg.entregaAt.toISOString() : null,
    movimientos: [],
  }));

  return { soloEntregados, soloCobrados, ambos };
}

// ---------------------------------------------------------------------
// Auditoría financiera: quién recibió, quién entregó, quién cobró, quién
// corrigió — y la única inconsistencia que puede detectarse de verdad con
// los datos que existen: un paquete que ya figura ENTREGADO en el período
// pero no tiene ningún Pago asociado (montoPagado <= 0). "estadoPago"
// nunca puede quedar en PAGADO sin un Pago real detrás (ver
// registrarPago() en package-transitions.ts, único lugar que lo toca), así
// que esa combinación específica no puede ocurrir por diseño — no se
// inventa una comprobación ahí donde el propio código ya lo garantiza.
// ---------------------------------------------------------------------

export interface AuditoriaOperadorDTO {
  userId: string | null;
  usuario: string;
  recepciones: number;
  entregas: number;
  entregasNormales: number;
  entregasExcepcionales: number;
  entregasImportacion: number;
  cobros: number;
  montoCobrado: number;
  anticipos: number;
  montoAnticipos: number;
  ajustes: number;
  montoAjustes: number;
  entregasSinCobro: number;
  cobrosSinEntrega: number;
}

export interface PagoDuplicadoDTO {
  codigo: string;
  tipo: string;
  monto: number;
  primeraFecha: string;
  segundaFecha: string;
  segundosEntre: number;
  usuario: string;
}

export interface AuditoriaFinancieraDTO {
  ingresos: number;
  pagosRegistrados: number;
  paquetesEntregados: number;
  entregasSinCobro: number;
  codigosSinCobro: string[];
  posiblesDuplicados: PagoDuplicadoDTO[];
  porOperador: AuditoriaOperadorDTO[];
}

function nombreUsuario(map: Map<string, string>, userId: string | null): string {
  if (!userId) return 'Sistema';
  return map.get(userId) ?? 'Usuario eliminado';
}

// Dos movimientos del mismo paquete, mismo tipo y mismo monto, a menos de
// esta ventana de tiempo entre si, son sospechosos de ser un doble envio
// accidental (ej. una correccion enviada dos veces por un doble clic) en
// vez de dos correcciones deliberadas separadas — ver seccion 10.F/H de la
// especificacion. entregarPaquete() ya esta protegido atomicamente contra
// esto (verificado con pruebas reales, ver informe), asi que en la
// practica esto solo puede detectar el caso mas dificil de blindar del
// mismo modo: dos PATCH de "corregir cobro" casi simultaneos.
const VENTANA_DUPLICADO_SEGUNDOS = 15;

/** Auditoría por operador (Recepción/Entrega/Finanzas) + detección de inconsistencias reales, para el período dado. */
export async function getAuditoriaFinanciera(rango: RangoFecha): Promise<AuditoriaFinancieraDTO> {
  const fechaFiltro = whereRango(rango);

  const [usuarios, resumen, entregasHist, cobrosPorOperador, anticiposPorOperador, ajustesPorOperador, recepcionesPorOperador, entregadosSinCobro, pagosRegistrados, pagos] =
    await Promise.all([
      prisma.user.findMany({ select: { id: true, nombre: true } }),
      getResumenFinanciero(rango),
      prisma.packageHistory.findMany({
        where: { estado: 'ENTREGADO', ...(fechaFiltro ? { fecha: fechaFiltro } : {}) },
        select: { userId: true, packageId: true, package: { select: { origenEntrega: true } } },
      }),
      prisma.pago.groupBy({
        by: ['userId'],
        where: { tipo: 'COBRO_ENTREGA', ...(fechaFiltro ? { createdAt: fechaFiltro } : {}) },
        _count: { _all: true },
        _sum: { monto: true },
      }),
      prisma.pago.groupBy({
        by: ['userId'],
        where: { tipo: 'ANTICIPO', ...(fechaFiltro ? { createdAt: fechaFiltro } : {}) },
        _count: { _all: true },
        _sum: { monto: true },
      }),
      prisma.pago.groupBy({
        by: ['userId'],
        where: { tipo: 'AJUSTE', ...(fechaFiltro ? { createdAt: fechaFiltro } : {}) },
        _count: { _all: true },
        _sum: { monto: true },
      }),
      prisma.package.groupBy({
        by: ['registradoPorId'],
        where: fechaFiltro ? { ingresoAt: fechaFiltro } : {},
        _count: { _all: true },
      }),
      prisma.package.findMany({
        where: { status: 'ENTREGADO', montoPagado: { lte: 0 }, ...(fechaFiltro ? { entregaAt: fechaFiltro } : {}) },
        select: { id: true, code: true },
      }),
      prisma.pago.count({ where: { tipo: 'COBRO_ENTREGA', ...(fechaFiltro ? { createdAt: fechaFiltro } : {}) } }),
      prisma.pago.findMany({
        where: fechaFiltro ? { createdAt: fechaFiltro } : {},
        select: { packageId: true, tipo: true, monto: true, userId: true, createdAt: true, package: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

  const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre] as const));
  // Quien entregó cada paquete, para poder atribuir "entregado sin cobro" a
  // un operador (el paquete no tiene su propio campo "entregadoPorId" — se
  // reutiliza PackageHistory, ya escrito por transicionar() en la misma
  // transaccion que la entrega, en vez de duplicar el dato en Package).
  const entregadorPorPackageId = new Map(entregasHist.map((h) => [h.packageId, h.userId] as const));
  const cobroEntregaPkgIds = new Set(pagos.filter((p) => p.tipo === 'COBRO_ENTREGA').map((p) => p.packageId));

  const filas = new Map<string, AuditoriaOperadorDTO>();
  function fila(userId: string | null): AuditoriaOperadorDTO {
    const key = userId ?? '__sistema__';
    let f = filas.get(key);
    if (!f) {
      f = {
        userId,
        usuario: nombreUsuario(nombrePorId, userId),
        recepciones: 0,
        entregas: 0,
        entregasNormales: 0,
        entregasExcepcionales: 0,
        entregasImportacion: 0,
        cobros: 0,
        montoCobrado: 0,
        anticipos: 0,
        montoAnticipos: 0,
        ajustes: 0,
        montoAjustes: 0,
        entregasSinCobro: 0,
        cobrosSinEntrega: 0,
      };
      filas.set(key, f);
    }
    return f;
  }

  for (const r of recepcionesPorOperador) fila(r.registradoPorId).recepciones = r._count._all;
  for (const h of entregasHist) {
    const f = fila(h.userId);
    f.entregas += 1;
    if (h.package.origenEntrega === 'EXCEPCIONAL') f.entregasExcepcionales += 1;
    else if (h.package.origenEntrega === 'IMPORTACION') f.entregasImportacion += 1;
    else f.entregasNormales += 1;
  }
  for (const c of cobrosPorOperador) {
    const f = fila(c.userId);
    f.cobros = c._count._all;
    f.montoCobrado = Math.round((c._sum.monto ?? 0) * 100) / 100;
  }
  for (const a of anticiposPorOperador) {
    const f = fila(a.userId);
    f.anticipos = a._count._all;
    f.montoAnticipos = Math.round((a._sum.monto ?? 0) * 100) / 100;
  }
  for (const a of ajustesPorOperador) {
    const f = fila(a.userId);
    f.ajustes = a._count._all;
    f.montoAjustes = Math.round((a._sum.monto ?? 0) * 100) / 100;
  }
  for (const pkg of entregadosSinCobro) {
    fila(entregadorPorPackageId.get(pkg.id) ?? null).entregasSinCobro += 1;
  }
  // "Cobros sin entrega": anticipos/ajustes de este operador cuyo paquete
  // no tiene un COBRO_ENTREGA en este mismo periodo (la entrega ocurrio en
  // otro dia, o el paquete todavia no fue entregado) — la explicacion mas
  // probable de que "paquetes cobrados" supere a "entregados" (ver
  // getReconciliacion arriba).
  for (const p of pagos) {
    if ((p.tipo === 'ANTICIPO' || p.tipo === 'AJUSTE') && !cobroEntregaPkgIds.has(p.packageId)) {
      fila(p.userId).cobrosSinEntrega += 1;
    }
  }

  const porOperador = Array.from(filas.values())
    .filter((f) => f.recepciones + f.entregas + f.cobros + f.anticipos + f.ajustes + f.entregasSinCobro > 0)
    .sort((a, b) => b.entregas + b.cobros - (a.entregas + a.cobros));

  // Posibles duplicados: mismo paquete + mismo tipo + mismo monto, dos
  // veces, a menos de VENTANA_DUPLICADO_SEGUNDOS entre si.
  const porClave = new Map<string, typeof pagos>();
  for (const p of pagos) {
    const clave = `${p.packageId}|${p.tipo}|${p.monto}`;
    const lista = porClave.get(clave) ?? [];
    lista.push(p);
    porClave.set(clave, lista);
  }
  const posiblesDuplicados: PagoDuplicadoDTO[] = [];
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue;
    for (let i = 1; i < lista.length; i++) {
      const actual = lista[i];
      const anterior = lista[i - 1];
      if (!actual || !anterior) continue;
      const segundos = (actual.createdAt.getTime() - anterior.createdAt.getTime()) / 1000;
      if (segundos <= VENTANA_DUPLICADO_SEGUNDOS) {
        posiblesDuplicados.push({
          codigo: actual.package.code,
          tipo: actual.tipo,
          monto: actual.monto,
          primeraFecha: anterior.createdAt.toISOString(),
          segundaFecha: actual.createdAt.toISOString(),
          segundosEntre: Math.round(segundos * 10) / 10,
          usuario: nombreUsuario(nombrePorId, actual.userId),
        });
      }
    }
  }

  return {
    ingresos: resumen.ingresos,
    pagosRegistrados,
    paquetesEntregados: entregasHist.length,
    entregasSinCobro: entregadosSinCobro.length,
    codigosSinCobro: entregadosSinCobro.map((p) => p.code),
    posiblesDuplicados,
    porOperador,
  };
}
