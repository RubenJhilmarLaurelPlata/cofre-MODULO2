// src/lib/package-detail.ts
// Punto unico para traer un paquete + su costo calculado. Lo usan las APIs
// de Entrega, Deposito, Buscador y Reportes, para no repetir esta logica
// en cada endpoint.

import { prisma } from '@/lib/prisma';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { normalizarCodigo } from '@/lib/codigo';
import type { Package, Company, Prisma } from '@prisma/client';
import type { PackageStatus, PaymentStatus } from '@/types';

export interface ClienteInfoDTO {
  nombre: string | null;
  emprendimiento: string | null;
  telefono: string | null;
  observaciones: string | null;
}

export interface PackageDetailDTO {
  code: string;
  inicial: string;
  status: PackageStatus;
  ingresoAt: Date;
  depositoAt: Date | null;
  pendienteAt: Date | null;
  entregaAt: Date | null;
  denegadoAt: Date | null;
  observaciones: string;
  descripcion: string | null;
  remitente: string | null;
  remitenteTelefono: string | null;
  destinatario: string | null;
  destinatarioTelefono: string | null;
  destinatarioObservaciones: string | null;
  // "IMPORTACION" si la entrega se marco mediante una importacion
  // administrativa (Fase 2), null si fue una entrega normal por
  // lector/manual — nunca debe mostrarse como si fuera lo mismo.
  origenEntrega: string | null;
  // Nombre del lote de importacion (Fase 3), solo cuando origenEntrega
  // es 'IMPORTACION'. A proposito NO se llena en buildPackageDetailDTO/
  // toPackageDetailDTOList (Dashboard/Reportes no lo necesitan) — cada
  // endpoint que sí lo muestra (Entrega, Buscador) lo agrega aparte con
  // getLotesPorPackageId(), ver src/lib/importacion.ts.
  lote?: string | null;
  dias: number;
  costoAcumulado: number;
  moneda: string;
  fotoUrl: string | null;
  cliente: ClienteInfoDTO | null;
  estadoPago: PaymentStatus;
  montoPagado: number;
  saldoPendiente: number;
}

/**
 * Version ligera de un paquete ya ENTREGADO, para listas como
 * "Entregados recientemente" (Fase 3) donde no hace falta el costo
 * recalculado (esta congelado desde entregaAt) ni el resto de columnas
 * de Package — evita traer la fila completa y pasarla por
 * toPackageDetailDTOList() cuando solo se necesitan estos campos.
 */
export interface EntregaRecienteDTO {
  code: string;
  entregaAt: Date;
  montoPagado: number;
  estadoPago: PaymentStatus;
  destinatario: string | null;
  origenEntrega: string | null;
  lote: string | null;
}

/** Fecha a la que se congela el calculo de costo/dias: entrega o denegacion si ya paso, si no la fecha actual. Compartida por Entrega, Deposito, Buscador, Reportes y Dashboard. */
export function fechaReferencia(pkg: Pick<Package, 'status' | 'entregaAt' | 'denegadoAt'>): Date {
  if (pkg.status === 'ENTREGADO' && pkg.entregaAt) return pkg.entregaAt;
  if (pkg.status === 'DENEGADO' && pkg.denegadoAt) return pkg.denegadoAt;
  return new Date();
}

type ClienteRelacionado = { nombre: string | null; emprendimiento: string | null; telefono: string | null; observaciones: string | null } | null;

/**
 * Version sincrona: usada cuando la config y los feriados ya se cargaron
 * una sola vez para varios paquetes (ver toPackageDetailDTOList). El
 * cliente asociado es opcional: las vistas de lista (reportes, dashboard)
 * no lo necesitan y así evitan un JOIN/consulta extra por paquete.
 */
function buildPackageDetailDTO(pkg: Package, company: Company, feriados: Set<string>, cliente?: ClienteRelacionado): PackageDetailDTO {
  const costo = calcularCosto(
    pkg.ingresoAt,
    fechaReferencia(pkg),
    { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
    feriados,
    pkg.tarifaBaseOverride,
    pkg.diasIncluidosOverride
  );

  const saldoPendiente = Math.round((costo.total - pkg.montoPagado) * 100) / 100;
  // El pago anticipado no "congela" el costo (ver especificación, Pagos
  // anticipados): un paquete pagado por completo el día 1 puede volver a
  // deber dinero más adelante si acumula días extra. Por eso el estado de
  // pago que se muestra siempre se deriva en vivo del saldo actual, en
  // vez de confiar en el último valor que quedó guardado en
  // Package.estadoPago (que solo se actualiza cuando ocurre un pago y se
  // volvería obsoleto con el simple paso de los días).
  const estadoPago: PaymentStatus = saldoPendiente <= 0 ? (pkg.montoPagado > 0 ? 'PAGADO' : 'PENDIENTE') : pkg.montoPagado > 0 ? 'PARCIAL' : 'PENDIENTE';

  return {
    code: pkg.code,
    inicial: pkg.inicial,
    status: pkg.status as PackageStatus,
    ingresoAt: pkg.ingresoAt,
    depositoAt: pkg.depositoAt,
    pendienteAt: pkg.pendienteAt,
    entregaAt: pkg.entregaAt,
    denegadoAt: pkg.denegadoAt,
    observaciones: pkg.observaciones,
    descripcion: pkg.descripcion,
    remitente: pkg.remitente,
    remitenteTelefono: pkg.remitenteTelefono,
    destinatario: pkg.destinatario,
    destinatarioTelefono: pkg.destinatarioTelefono,
    destinatarioObservaciones: pkg.destinatarioObservaciones,
    origenEntrega: pkg.origenEntrega,
    dias: costo.dias,
    costoAcumulado: costo.total,
    moneda: company.moneda,
    fotoUrl: pkg.fotoArchivo ? `/api/paquetes/${pkg.code}/foto` : null,
    cliente: cliente ?? null,
    estadoPago,
    montoPagado: pkg.montoPagado,
    saldoPendiente,
  };
}

export async function toPackageDetailDTO(pkg: Package): Promise<PackageDetailDTO> {
  const [company, feriados, cliente] = await Promise.all([
    getCompanyConfig(),
    getHolidaySet(),
    pkg.clienteId ? prisma.cliente.findUnique({ where: { id: pkg.clienteId } }) : Promise.resolve(null),
  ]);
  return buildPackageDetailDTO(pkg, company, feriados, cliente);
}

/** Igual que toPackageDetailDTO pero trayendo la config de empresa y los feriados una sola vez para toda la lista, en vez de una vez por paquete. No incluye datos de cliente (no se usa en vistas de lista). */
export async function toPackageDetailDTOList(pkgs: Package[]): Promise<PackageDetailDTO[]> {
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  return pkgs.map((pkg) => buildPackageDetailDTO(pkg, company, feriados));
}

export async function getPackageDetail(codeRaw: string): Promise<PackageDetailDTO | null> {
  const codigoNormalizado = normalizarCodigo(codeRaw);
  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado } });
  if (!pkg) return null;
  return toPackageDetailDTO(pkg);
}

/** Un evento del historial de un paquete, usado por el Buscador para mostrar la linea de tiempo completa. */
export interface HistorialItemDTO {
  estado: string;
  fecha: string;
  usuario: string;
  nota: string | null;
}

const TIPO_PAGO_ESTADO: Record<string, string> = {
  ANTICIPO: 'PAGO_ANTICIPO',
  COBRO_ENTREGA: 'PAGO_COBRO_ENTREGA',
  AJUSTE: 'PAGO_AJUSTE',
};

/**
 * Linea de tiempo completa de un paquete, para el Buscador: no solo los
 * cambios de estado (PackageHistory) sino tambien cada movimiento real de
 * dinero (Pago) — asi recepcion, pago, entrega y correcciones aparecen
 * juntos y en orden, sin tener que abrir Finanzas por separado (ver
 * REGLA sobre "buscador de auditoria unificado").
 */
export async function getPackageHistorial(codeRaw: string): Promise<HistorialItemDTO[] | null> {
  const codigoNormalizado = normalizarCodigo(codeRaw);
  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado }, select: { id: true } });
  if (!pkg) return null;

  const [historial, pagos, company] = await Promise.all([
    prisma.packageHistory.findMany({
      where: { packageId: pkg.id },
      include: { user: { select: { nombre: true } } },
    }),
    prisma.pago.findMany({
      where: { packageId: pkg.id },
      include: { user: { select: { nombre: true } } },
    }),
    getCompanyConfig(),
  ]);

  const eventosEstado: Array<{ fecha: Date; item: HistorialItemDTO }> = historial.map((h) => ({
    fecha: h.fecha,
    item: { estado: h.estado, fecha: h.fecha.toISOString(), usuario: h.user?.nombre ?? 'Sistema', nota: h.nota },
  }));

  const eventosPago: Array<{ fecha: Date; item: HistorialItemDTO }> = pagos.map((p) => {
    const montoTexto = `${company.moneda} ${p.monto.toFixed(2)}`;
    const nota =
      p.tipo === 'AJUSTE' && p.montoAnterior !== null && p.montoNuevo !== null
        ? `De ${company.moneda} ${p.montoAnterior.toFixed(2)} a ${company.moneda} ${p.montoNuevo.toFixed(2)}${p.motivo ? ` — ${p.motivo}` : ''}`
        : p.motivo || `Monto: ${montoTexto}`;
    return {
      fecha: p.createdAt,
      item: {
        estado: TIPO_PAGO_ESTADO[p.tipo] ?? 'PAGO_AJUSTE',
        fecha: p.createdAt.toISOString(),
        usuario: p.user?.nombre ?? 'Sistema',
        nota,
      },
    };
  });

  return [...eventosEstado, ...eventosPago].sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).map((e) => e.item);
}

/**
 * Condiciones OR para buscar un texto libre en los campos de un paquete:
 * codigo, remitente, destinatario, telefonos y observaciones. Usado por
 * el Buscador y por Reportes para no repetir esta lista de campos en
 * cada endpoint.
 */
export function construirFiltroTextoPaquete(q: string, opts?: { incluirUsuarioRegistrador?: boolean }): NonNullable<Prisma.PackageWhereInput['OR']> {
  const or: NonNullable<Prisma.PackageWhereInput['OR']> = [
    { code: { contains: q } },
    // También busca por código sin guiones/espacios (ver src/lib/codigo.ts),
    // para que "M24J125" encuentre "M24J-125" igual que la búsqueda exacta.
    { codigoNormalizado: { contains: normalizarCodigo(q) } },
    { remitente: { contains: q } },
    { remitenteTelefono: { contains: q } },
    { destinatario: { contains: q } },
    { destinatarioTelefono: { contains: q } },
    { observaciones: { contains: q } },
    { cliente: { nombre: { contains: q } } },
    { cliente: { emprendimiento: { contains: q } } },
    { cliente: { telefono: { contains: q } } },
  ];
  if (opts?.incluirUsuarioRegistrador) {
    or.push({ registradoPor: { nombre: { contains: q } } });
  }
  return or;
}
