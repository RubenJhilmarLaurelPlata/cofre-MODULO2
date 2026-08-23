// src/lib/dashboard-data.ts
import { prisma } from '@/lib/prisma';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto, dateKey } from '@/lib/pricing';
import { fechaReferencia } from '@/lib/package-detail';
import { getResumenFinanciero } from '@/lib/finanzas';
import type { Package } from '@prisma/client';
import type { PackageStatus } from '@/types';

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Lunes de la semana que contiene `d` — NUNCA `d.getDay()` a secas (esa
 * es la causa raiz de un bug real confirmado: Date.getDay() usa la
 * convencion domingo=0/lunes=1/.../sabado=6, asi que "d menos d.getDay()
 * dias" da domingo como inicio de semana. Cofre Express opera
 * LUNES→SÁBADO, domingo no cuenta para nada (ver pricing.ts) — con esa
 * formula, un domingo cualquiera "esta semana" colapsaba a un solo dia
 * (el domingo mismo), dejando afuera el sabado anterior con toda su
 * actividad real. Antes esta formula vivia duplicada e identica en
 * dashboard-data.ts y reportes.ts; ahora es una sola funcion que ambos
 * importan, para que "esta semana" signifique EXACTAMENTE lo mismo en
 * Dashboard, Finanzas y Reportes.
 */
export function inicioSemanaLunes(d: Date): Date {
  const diasDesdeLunes = (d.getDay() + 6) % 7; // domingo(0)->6, lunes(1)->0, ..., sabado(6)->5
  return addDays(d, -diasDesdeLunes);
}

export interface SeriePunto {
  fecha: string;
  ingresados: number;
  entregados: number;
}

/**
 * Arma la serie diaria de ingresados/entregados para cualquier rango de
 * dias (Fase 4A): antes esta logica vivia inline solo para "ultimos 7
 * dias" dentro de getDashboardData(); ahora la usan tanto la carga
 * inicial del Dashboard (7 dias) como el endpoint de periodo real
 * (7/30/90/365/personalizado, ver src/app/api/dashboard/grafico/route.ts)
 * — una sola forma de calcularlo, nunca dos.
 */
export function calcularSerieDiaria(paquetes: Array<{ ingresoAt: Date; entregaAt: Date | null }>, desde: Date, diasCount: number): SeriePunto[] {
  const serie: SeriePunto[] = [];
  for (let i = 0; i < diasCount; i++) {
    const dia = addDays(desde, i);
    const diaSiguiente = addDays(dia, 1);
    serie.push({
      fecha: dateKey(dia),
      ingresados: paquetes.filter((p) => p.ingresoAt >= dia && p.ingresoAt < diaSiguiente).length,
      entregados: paquetes.filter((p) => p.entregaAt && p.entregaAt >= dia && p.entregaAt < diaSiguiente).length,
    });
  }
  return serie;
}

/**
 * Campos minimos de Package que necesita el calculo de costo — nunca los
 * 25+ columnas completas (foto, observaciones, telefonos, etc.). El
 * Dashboard puede sumar miles de paquetes en un solo request; traer solo
 * esto reduce drasticamente el trafico Prisma-SQLite y el JSON que viaja
 * entre el runtime de la base de datos y Node a medida que crece el
 * historico (spec: "no cargar datos historicos completos").
 */
export type PaqueteParaCosto = Pick<Package, 'ingresoAt' | 'entregaAt' | 'denegadoAt' | 'status' | 'tarifaBaseOverride' | 'diasIncluidosOverride'>;
const SELECT_PARA_COSTO = {
  ingresoAt: true,
  entregaAt: true,
  denegadoAt: true,
  status: true,
  tarifaBaseOverride: true,
  diasIncluidosOverride: true,
} as const;

/** Suma el costo acumulado de una lista de paquetes. Compartida con Reportes (Modulo 6). */
export function sumarCosto(
  paquetes: PaqueteParaCosto[],
  reglas: { tarifaBase: number; diasIncluidos: number; costoAdicionalDia: number },
  feriados: Set<string>
): number {
  const total = paquetes.reduce((acc, p) => {
    const costo = calcularCosto(p.ingresoAt, fechaReferencia(p), reglas, feriados, p.tarifaBaseOverride, p.diasIncluidosOverride);
    return acc + costo.total;
  }, 0);
  return Math.round(total * 100) / 100;
}

export interface PuntoCobrado {
  fecha: string;
  monto: number;
}

/**
 * Serie diaria de COBRADO real: dinero efectivamente recibido (Pago.monto
 * por dia, igual criterio que getResumenFinanciero) — NUNCA la tarifa
 * acumulada/estimada de los paquetes entregados ese dia. Antes esta serie
 * (y cobradoHoy/cobradoAyer/etc. mas abajo) usaban sumarCosto() sobre
 * paquetes entregados, lo que podia divergir de Finanzas y Reportes para
 * el mismo periodo exacto (un anticipo pagado dias antes de la entrega,
 * un ajuste, una tarifa especial) — ver "Finanzas: una sola fuente de
 * verdad". Ahora las tres pantallas sacan "cobrado" del mismo lugar:
 * la tabla Pago.
 */
function calcularSerieIngresos(pagos: Array<{ createdAt: Date; monto: number }>, desde: Date, diasCount: number): PuntoCobrado[] {
  const serie: PuntoCobrado[] = [];
  for (let i = 0; i < diasCount; i++) {
    const dia = addDays(desde, i);
    const diaSiguiente = addDays(dia, 1);
    const delDia = pagos.filter((p) => p.createdAt >= dia && p.createdAt < diaSiguiente);
    const monto = Math.round(delDia.reduce((acc, p) => acc + p.monto, 0) * 100) / 100;
    serie.push({ fecha: dateKey(dia), monto });
  }
  return serie;
}

export interface DashboardData {
  ingresadosHoy: number;
  ingresadosAyer: number;
  entregadosHoy: number;
  entregadosAyer: number;
  denegadosHoy: number;
  cobradoHoy: number;
  cobradoAyer: number;
  cobradoSemana: number;
  cobradoSemanaAnterior: number;
  cobradoMes: number;
  cobradoMesAnterior: number;
  gastosMes: number;
  paquetesActivos: number;
  montoEstimadoSiSeRetiranHoy: number;
  estados: Record<'EN_PAQUETERIA' | 'EN_DEPOSITO' | 'PENDIENTE_BAJAR' | 'ENTREGADO' | 'DENEGADO', number>;
  ultimos7: SeriePunto[];
  cobradoUltimos7: PuntoCobrado[];
  actividadReciente: Array<{ code: string; estado: string; fecha: Date; usuario: string; montoPagado: number }>;
  moneda: string;
}

export async function getDashboardData(): Promise<DashboardData> {
  const hoy = startOfDay(new Date());
  const manana = addDays(hoy, 1);
  const ayer = addDays(hoy, -1);
  const inicioSemana = inicioSemanaLunes(hoy);
  const inicioSemanaAnterior = addDays(inicioSemana, -7);
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const inicioMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const hace6Dias = addDays(hoy, -6);

  const [
    company,
    feriados,
    conteoEstados,
    ingresadosHoy,
    ingresadosAyer,
    entregadosHoy,
    entregadosAyer,
    activos,
    ingresosUltimos7,
    pagosUltimos7,
    denegadosHoy,
    actividadRaw,
    resumenHoy,
    resumenAyer,
    resumenSemana,
    resumenSemanaAnterior,
    resumenMes,
    resumenMesAnterior,
  ] = await Promise.all([
    getCompanyConfig(),
    getHolidaySet(),
    prisma.package.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.package.count({ where: { ingresoAt: { gte: hoy, lt: manana } } }),
    prisma.package.count({ where: { ingresoAt: { gte: ayer, lt: hoy } } }),
    prisma.package.count({ where: { entregaAt: { gte: hoy, lt: manana } } }),
    prisma.package.count({ where: { entregaAt: { gte: ayer, lt: hoy } } }),
    prisma.package.findMany({
      where: { status: { in: ['EN_PAQUETERIA', 'EN_DEPOSITO', 'PENDIENTE_BAJAR'] } },
      select: SELECT_PARA_COSTO,
    }),
    prisma.package.findMany({
      // OR (no solo ingresoAt): un paquete ingresado antes de la
      // ventana pero entregado dentro de ella tambien debe contar como
      // "entregado" ese dia.
      where: { OR: [{ ingresoAt: { gte: hace6Dias, lt: manana } }, { entregaAt: { gte: hace6Dias, lt: manana } }] },
      select: { ingresoAt: true, entregaAt: true },
    }),
    // Dinero real recibido en los ultimos 7 dias (ver calcularSerieIngresos).
    prisma.pago.findMany({ where: { createdAt: { gte: hace6Dias, lt: manana } }, select: { createdAt: true, monto: true } }),
    prisma.package.count({ where: { denegadoAt: { gte: hoy, lt: manana } } }),
    prisma.packageHistory.findMany({
      orderBy: { fecha: 'desc' },
      take: 8,
      include: { package: { select: { code: true, montoPagado: true } }, user: { select: { nombre: true } } },
    }),
    // "Cobrado" = SIEMPRE el libro real de Pago (getResumenFinanciero),
    // nunca una estimacion de tarifa recalculada aqui — es la misma
    // funcion que ya usan Finanzas y Reportes, para que consultar
    // exactamente el mismo periodo de un mismo dato exacto en las tres
    // pantallas (ver "Finanzas: una sola fuente de verdad").
    getResumenFinanciero({ desde: hoy, hasta: manana }),
    getResumenFinanciero({ desde: ayer, hasta: hoy }),
    getResumenFinanciero({ desde: inicioSemana, hasta: manana }),
    getResumenFinanciero({ desde: inicioSemanaAnterior, hasta: inicioSemana }),
    getResumenFinanciero({ desde: inicioMes, hasta: manana }),
    getResumenFinanciero({ desde: inicioMesAnterior, hasta: inicioMes }),
  ]);

  const reglas = {
    tarifaBase: company.tarifaBase,
    diasIncluidos: company.diasIncluidos,
    costoAdicionalDia: company.costoAdicionalDia,
  };

  const estados = {
    EN_PAQUETERIA: 0,
    EN_DEPOSITO: 0,
    PENDIENTE_BAJAR: 0,
    ENTREGADO: 0,
    DENEGADO: 0,
  };
  conteoEstados.forEach((row) => {
    estados[row.status as PackageStatus] = row._count.status;
  });

  const ultimos7 = calcularSerieDiaria(ingresosUltimos7, hace6Dias, 7);
  const cobradoUltimos7 = calcularSerieIngresos(pagosUltimos7, hace6Dias, 7);

  return {
    ingresadosHoy,
    ingresadosAyer,
    entregadosHoy,
    entregadosAyer,
    denegadosHoy,
    cobradoHoy: resumenHoy.ingresos,
    cobradoAyer: resumenAyer.ingresos,
    cobradoSemana: resumenSemana.ingresos,
    cobradoSemanaAnterior: resumenSemanaAnterior.ingresos,
    cobradoMes: resumenMes.ingresos,
    cobradoMesAnterior: resumenMesAnterior.ingresos,
    gastosMes: resumenMes.gastos,
    paquetesActivos: activos.length,
    montoEstimadoSiSeRetiranHoy: sumarCosto(activos, reglas, feriados),
    estados,
    ultimos7,
    cobradoUltimos7,
    actividadReciente: actividadRaw.map((h) => ({
      code: h.package.code,
      estado: h.estado,
      fecha: h.fecha,
      usuario: h.user?.nombre ?? 'Sistema',
      montoPagado: h.package.montoPagado,
    })),
    moneda: company.moneda,
  };
}
