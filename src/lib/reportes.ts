// src/lib/reportes.ts
// Logica central del Modulo 6 (Reportes): resuelve el rango de fechas
// compartido por todos los reportes y calcula cada uno de los 5 reportes
// (Paquetes, Financiero, Operadores, Deposito, Etiquetas) contra la base
// de datos real. Reutiliza pricing.ts, package-detail.ts, dashboard-data.ts
// y etiquetas.ts en vez de recalcular sus reglas de negocio.

import { prisma } from '@/lib/prisma';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { diasTranscurridos, dateKey } from '@/lib/pricing';
import { fechaReferencia, construirFiltroTextoPaquete } from '@/lib/package-detail';
import { sumarCosto, inicioSemanaLunes } from '@/lib/dashboard-data';
import { getResumenFinanciero } from '@/lib/finanzas';
import { buscarLotes } from '@/lib/etiquetas';
import { canonicalizarSeparadores } from '@/lib/codigo';
import type { Prisma } from '@prisma/client';
import type { PackageStatus } from '@/types';

export type ModoFechaReporte = 'hoy' | 'ayer' | 'semana' | 'mes' | 'especifica' | 'rango';

export interface FiltrosReporte {
  modo: ModoFechaReporte;
  fecha?: string;
  fechaInicio?: string;
  fechaFin?: string;
  estado?: PackageStatus;
  usuarioId?: string;
  inicial?: string;
  q?: string;
}

export interface Columna {
  key: string;
  label: string;
}

export interface TablaReporte {
  titulo: string;
  columnas: Columna[];
  filas: Array<Record<string, string | number>>;
}

export interface PuntoSerie {
  etiqueta: string;
  valor: number;
  valor2?: number;
}

export interface ResumenItem {
  label: string;
  value: string;
}

export interface ReporteResultado {
  resumen: ResumenItem[];
  serie?: { titulo: string; nombreValor: string; nombreValor2?: string; puntos: PuntoSerie[] };
  tablas: TablaReporte[];
}

function parseDateOnly(s: string): Date {
  const partes = s.split('-');
  return new Date(Number(partes[0]), Number(partes[1] ?? '1') - 1, Number(partes[2] ?? '1'));
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function hoyLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtFecha(d: Date): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Resuelve el rango [gte, lt) compartido por todos los reportes segun el modo elegido. */
export function resolverRangoFechas(filtros: Pick<FiltrosReporte, 'modo' | 'fecha' | 'fechaInicio' | 'fechaFin'>): { gte: Date; lt: Date; etiqueta: string } {
  const hoy = hoyLocal();

  switch (filtros.modo) {
    case 'hoy':
      return { gte: hoy, lt: addDays(hoy, 1), etiqueta: `Hoy (${fmtFecha(hoy)})` };
    case 'ayer': {
      const ayer = addDays(hoy, -1);
      return { gte: ayer, lt: hoy, etiqueta: `Ayer (${fmtFecha(ayer)})` };
    }
    case 'semana': {
      // Semana calendario COMPLETA (lunes a domingo), no "desde el lunes
      // hasta hoy": si hoy es lunes, la semana sigue siendo de 7 dias
      // (aunque los dias futuros todavia no tengan ningun registro, por
      // eso la suma no cambia) — antes "lt" y la etiqueta se cortaban en
      // "hoy", mostrando por ejemplo "Esta semana (24/08/2026 —
      // 24/08/2026)" un lunes, que parece un rango de un solo dia. Ver
      // especificacion, "Fechas: esta semana".
      const inicio = inicioSemanaLunes(hoy);
      const fin = addDays(inicio, 6);
      return { gte: inicio, lt: addDays(inicio, 7), etiqueta: `Esta semana (${fmtFecha(inicio)} — ${fmtFecha(fin)})` };
    }
    case 'mes': {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      return { gte: inicio, lt: addDays(hoy, 1), etiqueta: `Este mes (${fmtFecha(inicio)} — ${fmtFecha(hoy)})` };
    }
    case 'especifica': {
      const f = parseDateOnly(filtros.fecha ?? dateKey(hoy));
      return { gte: f, lt: addDays(f, 1), etiqueta: fmtFecha(f) };
    }
    case 'rango': {
      const a = parseDateOnly(filtros.fechaInicio ?? dateKey(hoy));
      const b = parseDateOnly(filtros.fechaFin ?? dateKey(hoy));
      return { gte: a, lt: addDays(b, 1), etiqueta: `${fmtFecha(a)} — ${fmtFecha(b)}` };
    }
  }
}

function reglasYFeriados() {
  return Promise.all([getCompanyConfig(), getHolidaySet()]);
}

/** Condiciones comunes a todos los reportes: estado, inicial, usuario (registrador) y texto libre. No incluye la fecha, que cada reporte aplica sobre el campo que corresponda. */
function filtrosComunesPaquete(filtros: FiltrosReporte): Prisma.PackageWhereInput {
  const where: Prisma.PackageWhereInput = {};
  if (filtros.estado) where.status = filtros.estado;
  if (filtros.inicial) where.inicial = filtros.inicial;
  if (filtros.usuarioId) where.registradoPorId = filtros.usuarioId;
  if (filtros.q) where.OR = construirFiltroTextoPaquete(filtros.q, { incluirUsuarioRegistrador: true });
  return where;
}

function diasSerie(gte: Date, lt: Date): string[] {
  const dias: string[] = [];
  const cursor = new Date(gte);
  let i = 0;
  while (cursor < lt && i < 92) {
    dias.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    i++;
  }
  return dias;
}

function fmtDias(n: number): string {
  return `${Math.round(n * 10) / 10} día${Math.round(n * 10) / 10 === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------
// Reporte de Paquetes
// ---------------------------------------------------------------------

export async function getReportePaquetes(filtros: FiltrosReporte): Promise<ReporteResultado> {
  const { gte, lt, etiqueta } = resolverRangoFechas(filtros);
  const comunes = filtrosComunesPaquete(filtros);
  // "Ingresados" sigue siendo el cohorte base de la tabla/serie/tiempo
  // promedio (tiene sentido: "de los que llegaron en este periodo, cuanto
  // tiempo llevan almacenados"). Pero "entregados" y "denegados" NUNCA
  // deben salir de este mismo cohorte filtrado por ingresoAt — un paquete
  // ingresado el 20/08 y entregado hoy es una entrega de HOY, no del
  // 20/08. Antes, "Total entregados" contaba status==ENTREGADO dentro del
  // conjunto ingresado en el periodo, lo que subcontaba entregas reales
  // (ver especificacion, "Bug critico: Reportes confunde ingreso con
  // entrega" — confirmado: Dashboard entregaAt-based mostraba 58,
  // Reportes ingresoAt+status mostraba 23, para el mismo dia).
  const where: Prisma.PackageWhereInput = { ...comunes, ingresoAt: { gte, lt } };

  const [paquetes, totalEntregados, totalDenegados, actualEnPaqueteria, actualEnDeposito, actualPendienteBajar] = await Promise.all([
    prisma.package.findMany({
      where,
      include: { registradoPor: { select: { nombre: true } } },
      orderBy: { ingresoAt: 'desc' },
      take: 2000,
    }),
    // "Total entregados": entregaAt (no ingresoAt) dentro del periodo —
    // incluye paquetes ingresados en cualquier fecha anterior.
    prisma.package.count({ where: { ...comunes, entregaAt: { gte, lt } } }),
    // "Denegados": denegadoAt (no ingresoAt) dentro del periodo, mismo motivo.
    prisma.package.count({ where: { ...comunes, denegadoAt: { gte, lt } } }),
    // "En paquetería/depósito/pendientes de bajar": estos NO representan
    // un evento con fecha propia dentro del periodo — son un ESTADO
    // ACTUAL (ver especificacion, seccion 2: "En depósito NO significa
    // ingresaron en este período"). Se reporta el conteo actual, igual
    // criterio que ya usa Dashboard (src/lib/dashboard-data.ts), para que
    // ambas pantallas sean conceptualmente coherentes.
    prisma.package.count({ where: { ...comunes, status: 'EN_PAQUETERIA' } }),
    prisma.package.count({ where: { ...comunes, status: 'EN_DEPOSITO' } }),
    prisma.package.count({ where: { ...comunes, status: 'PENDIENTE_BAJAR' } }),
  ]);

  const dias = paquetes.map((p) => diasTranscurridos(p.ingresoAt, fechaReferencia(p)));
  const promedio = dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : 0;
  const maximo = dias.length ? Math.max(...dias) : 0;
  const minimo = dias.length ? Math.min(...dias) : 0;

  const porDia = new Map<string, number>();
  for (const p of paquetes) porDia.set(dateKey(p.ingresoAt), (porDia.get(dateKey(p.ingresoAt)) ?? 0) + 1);
  const puntos = diasSerie(gte, lt).map((d) => ({ etiqueta: d, valor: porDia.get(d) ?? 0 }));

  return {
    resumen: [
      { label: 'Período', value: etiqueta },
      { label: 'Total ingresados (en el período)', value: String(paquetes.length) },
      { label: 'Total entregados (en el período)', value: String(totalEntregados) },
      { label: 'Denegados (en el período)', value: String(totalDenegados) },
      { label: 'En paquetería (estado actual)', value: String(actualEnPaqueteria) },
      { label: 'En depósito (estado actual)', value: String(actualEnDeposito) },
      { label: 'Pendientes de bajar (estado actual)', value: String(actualPendienteBajar) },
      { label: 'Tiempo promedio almacenado', value: fmtDias(promedio) },
      { label: 'Tiempo máximo', value: fmtDias(maximo) },
      { label: 'Tiempo mínimo', value: fmtDias(minimo) },
    ],
    serie: { titulo: 'Paquetes por día', nombreValor: 'Paquetes', puntos },
    tablas: [
      {
        titulo: 'Paquetes',
        columnas: [
          { key: 'code', label: 'Código' },
          { key: 'estado', label: 'Estado' },
          { key: 'inicial', label: 'Tipo' },
          { key: 'ingreso', label: 'Ingreso' },
          { key: 'entrega', label: 'Entrega' },
          { key: 'dias', label: 'Días' },
          { key: 'remitente', label: 'Remitente' },
          { key: 'destinatario', label: 'Destinatario' },
          { key: 'observaciones', label: 'Observaciones' },
          { key: 'registradoPor', label: 'Registrado por' },
        ],
        filas: paquetes.map((p) => ({
          code: p.code,
          estado: p.status,
          inicial: p.inicial,
          ingreso: fmtFecha(p.ingresoAt),
          entrega: p.entregaAt ? fmtFecha(p.entregaAt) : '',
          dias: diasTranscurridos(p.ingresoAt, fechaReferencia(p)),
          remitente: p.remitente ?? '',
          destinatario: p.destinatario ?? '',
          observaciones: p.observaciones,
          registradoPor: p.registradoPor?.nombre ?? '',
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------
// Reporte Financiero
// ---------------------------------------------------------------------

export async function getReporteFinanciero(filtros: FiltrosReporte): Promise<ReporteResultado> {
  const { gte, lt, etiqueta } = resolverRangoFechas(filtros);
  const [company, feriados] = await reglasYFeriados();
  const reglas = { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia };

  const where: Prisma.PackageWhereInput = { ...filtrosComunesPaquete(filtros), ingresoAt: { gte, lt } };
  const [paquetes, resumen] = await Promise.all([
    prisma.package.findMany({
      where,
      include: { registradoPor: { select: { nombre: true } } },
      orderBy: { ingresoAt: 'desc' },
      take: 2000,
    }),
    // "Cobrado" real del periodo: SIEMPRE getResumenFinanciero (el libro de
    // Pago), la misma fuente exacta que usan Dashboard y Finanzas — nunca
    // una tarifa recalculada aparte, para que consultar el mismo periodo
    // de un mismo dato de tres pantallas diferentes (Dashboard/Finanzas/
    // Reportes) sea siempre el mismo numero (ver "Finanzas: una sola
    // fuente de verdad"). Antes este reporte sumaba la tarifa acumulada de
    // los paquetes ENTREGADOS cuyo INGRESO cayera en el rango — una
    // definicion de "cobrado" doblemente distinta a la de Dashboard (que
    // usa la fecha de ENTREGA) y a la de Finanzas (que usa la fecha real
    // del pago).
    getResumenFinanciero({ desde: gte, hasta: lt }),
  ]);

  const entregados = paquetes.filter((p) => p.status === 'ENTREGADO');
  const activos = paquetes.filter((p) => ['EN_PAQUETERIA', 'EN_DEPOSITO', 'PENDIENTE_BAJAR'].includes(p.status));
  const denegados = paquetes.filter((p) => p.status === 'DENEGADO');

  const cobrado = resumen.ingresos;
  // "Pendiente"/"potencial" son deliberadamente distintos de "cobrado":
  // mientras cobrado es dinero real ya recibido (Pago), esto es una
  // ESTIMACION de tarifa sobre paquetes activos que ingresaron en el
  // periodo consultado — util para saber "cuanto podria cobrarse todavia
  // de lo que entro en este rango", pero no pretende igualar ningun otro
  // numero del sistema (el equivalente en Dashboard, "Si se retiran hoy",
  // es un snapshot global de AHORA, no acotado a un periodo pasado).
  const pendiente = sumarCosto(activos, reglas, feriados);

  // Costo por paquete calculado una sola vez y reutilizado en las 3
  // agregaciones (por operador, por tipo, por dia), en vez de recalcularlo
  // 3 veces para el mismo paquete. Esta distribucion sigue siendo una
  // ESTIMACION de tarifa (no hay hoy una forma de atribuir cada Pago real
  // a un operador/tipo especifico) — ver etiqueta "(estimado)" en las
  // columnas de las tablas de abajo.
  const costoPorPaquete = new Map(entregados.map((p) => [p.id, sumarCosto([p], reglas, feriados)]));

  const porOperador = new Map<string, { nombre: string; total: number; cantidad: number }>();
  for (const p of entregados) {
    const key = p.registradoPorId ?? 'sin-asignar';
    const nombre = p.registradoPor?.nombre ?? 'Sin asignar';
    const actual = porOperador.get(key) ?? { nombre, total: 0, cantidad: 0 };
    actual.total += costoPorPaquete.get(p.id) ?? 0;
    actual.cantidad += 1;
    porOperador.set(key, actual);
  }

  const porTipo = new Map<string, { total: number; cantidad: number }>();
  for (const p of entregados) {
    const actual = porTipo.get(p.inicial) ?? { total: 0, cantidad: 0 };
    actual.total += costoPorPaquete.get(p.id) ?? 0;
    actual.cantidad += 1;
    porTipo.set(p.inicial, actual);
  }

  // Serie diaria de COBRADO real (Pago.createdAt) — no la tarifa acumulada
  // de los paquetes: debe coincidir con el numero "Cobrado en el período"
  // de arriba dia por dia, igual criterio que cobradoUltimos7 del
  // Dashboard (ver src/lib/dashboard-data.ts).
  const pagosDelPeriodo = await prisma.pago.findMany({ where: { createdAt: { gte, lt } }, select: { createdAt: true, monto: true } });
  const porDia = new Map<string, number>();
  for (const pago of pagosDelPeriodo) {
    const key = dateKey(pago.createdAt);
    porDia.set(key, (porDia.get(key) ?? 0) + pago.monto);
  }
  const puntos = diasSerie(gte, lt).map((d) => ({ etiqueta: d, valor: Math.round((porDia.get(d) ?? 0) * 100) / 100 }));

  return {
    resumen: [
      { label: 'Período', value: etiqueta },
      { label: 'Cobrado en el período', value: `${company.moneda} ${cobrado.toFixed(2)}` },
      { label: 'Gastos en el período', value: `${company.moneda} ${resumen.gastos.toFixed(2)}` },
      { label: 'Resultado neto', value: `${company.moneda} ${resumen.resultadoNeto.toFixed(2)}` },
      { label: 'Paquetes cobrados (con algún pago)', value: String(resumen.paquetesCobrados) },
      { label: 'Pendiente por cobrar (de lo recibido en el período)', value: `${company.moneda} ${pendiente.toFixed(2)}` },
      { label: 'Paquetes entregados', value: String(entregados.length) },
      { label: 'Paquetes activos (pendientes)', value: String(activos.length) },
      { label: 'Paquetes denegados', value: String(denegados.length) },
    ],
    serie: { titulo: 'Cobrado por día', nombreValor: 'Cobrado', puntos },
    tablas: [
      {
        titulo: 'Tarifa acumulada por operador (estimado)',
        columnas: [
          { key: 'operador', label: 'Operador' },
          { key: 'cantidad', label: 'Paquetes entregados' },
          { key: 'total', label: 'Tarifa acumulada (estimado)' },
        ],
        filas: Array.from(porOperador.values()).map((v) => ({
          operador: v.nombre,
          cantidad: v.cantidad,
          total: `${company.moneda} ${v.total.toFixed(2)}`,
        })),
      },
      {
        titulo: 'Tarifa acumulada por tipo (estimado)',
        columnas: [
          { key: 'tipo', label: 'Tipo' },
          { key: 'cantidad', label: 'Paquetes entregados' },
          { key: 'total', label: 'Tarifa acumulada (estimado)' },
        ],
        filas: Array.from(porTipo.entries()).map(([inicial, v]) => ({
          tipo: inicial,
          cantidad: v.cantidad,
          total: `${company.moneda} ${v.total.toFixed(2)}`,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------
// Reporte de Operadores
// ---------------------------------------------------------------------

export async function getReporteOperadores(filtros: FiltrosReporte): Promise<ReporteResultado> {
  const { gte, lt, etiqueta } = resolverRangoFechas(filtros);

  const usuarios = await prisma.user.findMany({
    where: filtros.usuarioId ? { id: filtros.usuarioId } : undefined,
    orderBy: { nombre: 'asc' },
  });

  const paqueteWhere: Prisma.PackageWhereInput = {};
  if (filtros.inicial) paqueteWhere.inicial = filtros.inicial;
  if (filtros.q) paqueteWhere.OR = construirFiltroTextoPaquete(filtros.q);

  const historialWhere: Prisma.PackageHistoryWhereInput = {
    fecha: { gte, lt },
    ...(Object.keys(paqueteWhere).length > 0 ? { package: paqueteWhere } : {}),
  };

  const [registrosPorUsuario, historialEntregas, historialMovimientos] = await Promise.all([
    prisma.package.groupBy({
      by: ['registradoPorId'],
      where: { ...paqueteWhere, ingresoAt: { gte, lt } },
      _count: { _all: true },
    }),
    prisma.packageHistory.findMany({
      where: { ...historialWhere, estado: 'ENTREGADO' },
      include: { package: { select: { ingresoAt: true } } },
    }),
    prisma.packageHistory.groupBy({
      by: ['userId'],
      where: historialWhere,
      _count: { _all: true },
    }),
  ]);

  const registrosMap = new Map(registrosPorUsuario.map((r) => [r.registradoPorId ?? '', r._count._all]));
  const movimientosMap = new Map(historialMovimientos.map((r) => [r.userId ?? '', r._count._all]));

  const atencionPorUsuario = new Map<string, number[]>();
  const entregasPorUsuario = new Map<string, number>();
  for (const h of historialEntregas) {
    const key = h.userId ?? '';
    entregasPorUsuario.set(key, (entregasPorUsuario.get(key) ?? 0) + 1);
    const lista = atencionPorUsuario.get(key) ?? [];
    lista.push(diasTranscurridos(h.package.ingresoAt, h.fecha));
    atencionPorUsuario.set(key, lista);
  }

  const filas = usuarios.map((u) => {
    const dias = atencionPorUsuario.get(u.id) ?? [];
    const promedioAtencion = dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : 0;
    return {
      operador: u.nombre,
      rol: u.role,
      registrados: registrosMap.get(u.id) ?? 0,
      entregas: entregasPorUsuario.get(u.id) ?? 0,
      movimientos: movimientosMap.get(u.id) ?? 0,
      tiempoAtencion: dias.length ? fmtDias(promedioAtencion) : '—',
      ultimoAcceso: u.ultimoLoginAt ? fmtFecha(u.ultimoLoginAt) : 'Nunca',
    };
  });

  const totalRegistrados = filas.reduce((a, f) => a + Number(f.registrados), 0);
  const totalEntregas = filas.reduce((a, f) => a + Number(f.entregas), 0);
  const totalMovimientos = filas.reduce((a, f) => a + Number(f.movimientos), 0);

  const puntos = filas
    .filter((f) => Number(f.movimientos) > 0)
    .map((f) => ({ etiqueta: f.operador, valor: Number(f.movimientos) }));

  return {
    resumen: [
      { label: 'Período', value: etiqueta },
      { label: 'Paquetes registrados', value: String(totalRegistrados) },
      { label: 'Entregas realizadas', value: String(totalEntregas) },
      { label: 'Movimientos totales', value: String(totalMovimientos) },
    ],
    serie: { titulo: 'Movimientos por operador', nombreValor: 'Movimientos', puntos },
    tablas: [
      {
        titulo: 'Operadores',
        columnas: [
          { key: 'operador', label: 'Operador' },
          { key: 'rol', label: 'Rol' },
          { key: 'registrados', label: 'Registrados' },
          { key: 'entregas', label: 'Entregas' },
          { key: 'movimientos', label: 'Movimientos' },
          { key: 'tiempoAtencion', label: 'Tiempo promedio de atención' },
          { key: 'ultimoAcceso', label: 'Último acceso' },
        ],
        filas,
      },
    ],
  };
}

// ---------------------------------------------------------------------
// Reporte de Deposito
// ---------------------------------------------------------------------

async function contarBajadasDeDeposito(gte: Date, lt: Date): Promise<number> {
  const candidatos = await prisma.packageHistory.findMany({
    where: { estado: 'EN_PAQUETERIA', fecha: { gte, lt } },
    select: { id: true, packageId: true },
  });
  if (candidatos.length === 0) return 0;

  const packageIds = Array.from(new Set(candidatos.map((c) => c.packageId)));
  const todas = await prisma.packageHistory.findMany({
    where: { packageId: { in: packageIds }, estado: 'EN_PAQUETERIA' },
    select: { id: true, packageId: true },
    orderBy: { fecha: 'asc' },
  });

  const primeraPorPaquete = new Map<string, string>();
  for (const fila of todas) {
    if (!primeraPorPaquete.has(fila.packageId)) primeraPorPaquete.set(fila.packageId, fila.id);
  }

  return candidatos.filter((c) => primeraPorPaquete.get(c.packageId) !== c.id).length;
}

export async function getReporteDeposito(filtros: FiltrosReporte): Promise<ReporteResultado> {
  const { gte, lt, etiqueta } = resolverRangoFechas(filtros);
  const comunes = filtrosComunesPaquete(filtros);

  const [enviados, bajados, activosEnDeposito] = await Promise.all([
    prisma.package.findMany({ where: { ...comunes, depositoAt: { gte, lt } }, select: { id: true, code: true, depositoAt: true } }),
    contarBajadasDeDeposito(gte, lt),
    prisma.package.findMany({
      where: { ...comunes, status: { in: ['EN_DEPOSITO', 'PENDIENTE_BAJAR'] } },
      include: { registradoPor: { select: { nombre: true } } },
      orderBy: { depositoAt: 'asc' },
      take: 2000,
    }),
  ]);

  const ahora = new Date();
  const diasEnDeposito = activosEnDeposito.filter((p) => p.depositoAt).map((p) => diasTranscurridos(p.depositoAt!, ahora));
  const promedioEnDeposito = diasEnDeposito.length ? diasEnDeposito.reduce((a, b) => a + b, 0) / diasEnDeposito.length : 0;
  const pendientesBajar = activosEnDeposito.filter((p) => p.status === 'PENDIENTE_BAJAR').length;

  const porDia = new Map<string, number>();
  for (const p of enviados) if (p.depositoAt) porDia.set(dateKey(p.depositoAt), (porDia.get(dateKey(p.depositoAt)) ?? 0) + 1);
  const puntos = diasSerie(gte, lt).map((d) => ({ etiqueta: d, valor: porDia.get(d) ?? 0 }));

  return {
    resumen: [
      { label: 'Período', value: etiqueta },
      { label: 'Paquetes enviados a depósito', value: String(enviados.length) },
      { label: 'Paquetes bajados de depósito', value: String(bajados) },
      { label: 'Tiempo promedio en depósito (actual)', value: fmtDias(promedioEnDeposito) },
      { label: 'Pendientes de bajar', value: String(pendientesBajar) },
    ],
    serie: { titulo: 'Enviados a depósito por día', nombreValor: 'Enviados', puntos },
    tablas: [
      {
        titulo: 'Actualmente en depósito',
        columnas: [
          { key: 'code', label: 'Código' },
          { key: 'estado', label: 'Estado' },
          { key: 'enviado', label: 'Enviado a depósito' },
          { key: 'dias', label: 'Días en depósito' },
          { key: 'destinatario', label: 'Destinatario' },
          { key: 'registradoPor', label: 'Registrado por' },
        ],
        filas: activosEnDeposito.map((p) => ({
          code: p.code,
          estado: p.status,
          enviado: p.depositoAt ? fmtFecha(p.depositoAt) : '',
          dias: p.depositoAt ? diasTranscurridos(p.depositoAt, ahora) : 0,
          destinatario: p.destinatario ?? '',
          registradoPor: p.registradoPor?.nombre ?? '',
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------
// Reporte de Etiquetas
// ---------------------------------------------------------------------

export async function getReporteEtiquetas(filtros: FiltrosReporte): Promise<ReporteResultado> {
  const { gte, lt, etiqueta } = resolverRangoFechas(filtros);

  const where: Prisma.GeneratedCodeWhereInput = { createdAt: { gte, lt } };
  if (filtros.inicial) where.inicial = filtros.inicial;
  // GeneratedCode no tiene "codigoNormalizado" (a diferencia de Package,
  // ver construirFiltroTextoPaquete): su "code" siempre se guarda con
  // "-", asi que hay que canonicalizar el separador del texto buscado
  // aqui mismo para que "M19A/29" siga encontrando "M19A-29".
  if (filtros.q) where.code = { contains: canonicalizarSeparadores(filtros.q.trim()).toUpperCase() };

  const codigos = await prisma.generatedCode.findMany({ where, take: 5000 });
  const utilizados = codigos.filter((c) => c.usado).length;
  const totalReimpresiones = codigos.reduce((a, c) => a + c.vecesReimpreso, 0);

  const porDia = new Map<string, number>();
  for (const c of codigos) porDia.set(c.fechaGenerado, (porDia.get(c.fechaGenerado) ?? 0) + 1);
  const puntos = diasSerie(gte, lt).map((d) => ({ etiqueta: d, valor: porDia.get(d) ?? 0 }));

  const lotes = await buscarLotes({
    inicial: filtros.inicial,
    desde: dateKey(gte),
    hasta: dateKey(addDays(lt, -1)),
    q: filtros.q,
    limit: 500,
  });

  return {
    resumen: [
      { label: 'Período', value: etiqueta },
      { label: 'Códigos generados', value: String(codigos.length) },
      { label: 'Códigos utilizados', value: String(utilizados) },
      { label: 'Códigos pendientes', value: String(codigos.length - utilizados) },
      { label: 'Reimpresiones', value: String(totalReimpresiones) },
      { label: 'Lotes generados', value: String(lotes.length) },
    ],
    serie: { titulo: 'Códigos generados por día', nombreValor: 'Generados', puntos },
    tablas: [
      {
        titulo: 'Historial de lotes',
        columnas: [
          { key: 'rango', label: 'Rango' },
          { key: 'cantidad', label: 'Cantidad' },
          { key: 'fechas', label: 'Fechas' },
          { key: 'generadoPor', label: 'Generado por' },
          { key: 'creado', label: 'Generado el' },
          { key: 'observaciones', label: 'Observaciones' },
        ],
        filas: lotes.map((l) => ({
          rango: `${l.inicial}${l.separador}${l.primerConsecutivo} → ${l.inicial}${l.separador}${l.ultimoConsecutivo}`,
          cantidad: l.cantidad,
          fechas: l.fechaInicio === l.fechaFin ? l.fechaInicio : `${l.fechaInicio} → ${l.fechaFin}`,
          generadoPor: l.generadoPor,
          creado: fmtFecha(new Date(l.createdAt)),
          observaciones: l.observaciones,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------
// Usuarios (para el filtro "Usuario / Operador")
// ---------------------------------------------------------------------

export async function getUsuariosParaFiltro() {
  const usuarios = await prisma.user.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, role: true } });
  return usuarios;
}

// ---------------------------------------------------------------------
// Historial de reportes generados (auditoria)
// ---------------------------------------------------------------------

export type TipoReporte = 'PAQUETES' | 'FINANCIERO' | 'OPERADORES' | 'DEPOSITO' | 'ETIQUETAS';
export type FormatoExportacion = 'PDF' | 'EXCEL' | 'CSV';

export async function registrarReporteGenerado(tipo: TipoReporte, formato: FormatoExportacion, filtros: FiltrosReporte, userId: string): Promise<void> {
  await prisma.reportLog.create({
    data: { tipo, formato, filtros: JSON.stringify(filtros), userId },
  });
}

export interface HistorialReporteDTO {
  id: string;
  tipo: TipoReporte;
  formato: FormatoExportacion;
  filtros: FiltrosReporte;
  usuario: string;
  createdAt: string;
}

export async function getHistorialReportes(limit = 100): Promise<HistorialReporteDTO[]> {
  const logs = await prisma.reportLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { nombre: true } } },
  });

  return logs.map((l) => ({
    id: l.id,
    tipo: l.tipo as TipoReporte,
    formato: l.formato as FormatoExportacion,
    filtros: JSON.parse(l.filtros) as FiltrosReporte,
    usuario: l.user?.nombre ?? 'Sistema',
    createdAt: l.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------
// Parseo compartido de filtros desde query params (los 5 endpoints de
// reportes usan exactamente los mismos filtros).
// ---------------------------------------------------------------------

export const MODOS_FECHA: ModoFechaReporte[] = ['hoy', 'ayer', 'semana', 'mes', 'especifica', 'rango'];
const ESTADOS: PackageStatus[] = ['EN_PAQUETERIA', 'EN_DEPOSITO', 'PENDIENTE_BAJAR', 'ENTREGADO', 'DENEGADO'];

export function parseFiltrosReporte(url: URL): FiltrosReporte | { error: string } {
  const modoRaw = url.searchParams.get('modo') ?? 'hoy';
  if (!MODOS_FECHA.includes(modoRaw as ModoFechaReporte)) {
    return { error: 'Modo de fecha inválido.' };
  }
  const estadoRaw = url.searchParams.get('estado') ?? undefined;
  if (estadoRaw && !ESTADOS.includes(estadoRaw as PackageStatus)) {
    return { error: 'Estado inválido.' };
  }

  return {
    modo: modoRaw as ModoFechaReporte,
    fecha: url.searchParams.get('fecha') ?? undefined,
    fechaInicio: url.searchParams.get('fechaInicio') ?? undefined,
    fechaFin: url.searchParams.get('fechaFin') ?? undefined,
    estado: estadoRaw as PackageStatus | undefined,
    usuarioId: url.searchParams.get('usuarioId') ?? undefined,
    inicial: url.searchParams.get('inicial')?.trim().toUpperCase() || undefined,
    q: url.searchParams.get('q')?.trim() || undefined,
  };
}
