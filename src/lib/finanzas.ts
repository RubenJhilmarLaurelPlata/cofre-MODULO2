// src/lib/finanzas.ts
// Finanzas (Paso 1): a diferencia de "cobradoHoy" en el Dashboard (que es
// una ESTIMACION de tarifa acumulada sobre paquetes entregados, ver
// src/lib/dashboard-data.ts), los ingresos aqui son el LIBRO real de
// dinero cobrado: la suma de los movimientos en Pago (anticipos, cobros
// en entrega y ajustes) que efectivamente ocurrieron en el periodo. Es la
// fuente de verdad para "cuanto dinero entro" y para el cierre de caja.
import { prisma } from '@/lib/prisma';
import { registrarPago } from '@/lib/package-transitions';
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
