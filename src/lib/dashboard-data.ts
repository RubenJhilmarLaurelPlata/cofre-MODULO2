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
  actividadReciente: Array<{ code: string; estado: string; fecha: Date; usuario: string; montoPagado: number }>;
  moneda: string;
}

export async function getDashboardData(): Promise<DashboardData> {
  const hoy = startOfDay(new Date());
  const manana = addDays(hoy, 1);
  const ayer = addDays(hoy, -1);
  const inicioSemana = addDays(hoy, -hoy.getDay());
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
    entregadosHoyList,
    entregadosAyerList,
    entregadosSemanaList,
    entregadosSemanaAnteriorList,
    entregadosMesList,
    entregadosMesAnteriorList,
    activos,
    ingresosUltimos7,
    denegadosHoy,
    actividadRaw,
    resumenGastosMes,
  ] = await Promise.all([
    getCompanyConfig(),
    getHolidaySet(),
    prisma.package.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.package.count({ where: { ingresoAt: { gte: hoy, lt: manana } } }),
    prisma.package.count({ where: { ingresoAt: { gte: ayer, lt: hoy } } }),
    prisma.package.findMany({ where: { entregaAt: { gte: hoy, lt: manana } }, select: SELECT_PARA_COSTO }),
    prisma.package.findMany({ where: { entregaAt: { gte: ayer, lt: hoy } }, select: SELECT_PARA_COSTO }),
    prisma.package.findMany({ where: { entregaAt: { gte: inicioSemana, lt: manana } }, select: SELECT_PARA_COSTO }),
    prisma.package.findMany({ where: { entregaAt: { gte: inicioSemanaAnterior, lt: inicioSemana } }, select: SELECT_PARA_COSTO }),
    prisma.package.findMany({ where: { entregaAt: { gte: inicioMes, lt: manana } }, select: SELECT_PARA_COSTO }),
    prisma.package.findMany({ where: { entregaAt: { gte: inicioMesAnterior, lt: inicioMes } }, select: SELECT_PARA_COSTO }),
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
    prisma.package.count({ where: { denegadoAt: { gte: hoy, lt: manana } } }),
    prisma.packageHistory.findMany({
      orderBy: { fecha: 'desc' },
      take: 8,
      include: { package: { select: { code: true, montoPagado: true } }, user: { select: { nombre: true } } },
    }),
    // Gastos del mes (Fase 4A): reutiliza el mismo calculo que ya usa
    // Finanzas — nunca se reimplementa la suma de Gasto aparte.
    getResumenFinanciero({ desde: inicioMes, hasta: manana }),
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

  return {
    ingresadosHoy,
    ingresadosAyer,
    entregadosHoy: entregadosHoyList.length,
    entregadosAyer: entregadosAyerList.length,
    denegadosHoy,
    cobradoHoy: sumarCosto(entregadosHoyList, reglas, feriados),
    cobradoAyer: sumarCosto(entregadosAyerList, reglas, feriados),
    cobradoSemana: sumarCosto(entregadosSemanaList, reglas, feriados),
    cobradoSemanaAnterior: sumarCosto(entregadosSemanaAnteriorList, reglas, feriados),
    cobradoMes: sumarCosto(entregadosMesList, reglas, feriados),
    cobradoMesAnterior: sumarCosto(entregadosMesAnteriorList, reglas, feriados),
    gastosMes: resumenGastosMes.gastos,
    paquetesActivos: activos.length,
    montoEstimadoSiSeRetiranHoy: sumarCosto(activos, reglas, feriados),
    estados,
    ultimos7,
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
