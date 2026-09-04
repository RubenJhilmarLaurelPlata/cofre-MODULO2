// src/lib/package-detail.ts
// Punto unico para traer un paquete + su costo calculado. Lo usan las APIs
// de Entrega, Deposito, Buscador y Reportes, para no repetir esta logica
// en cada endpoint.

import { prisma } from '@/lib/prisma';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { normalizarCodigo } from '@/lib/codigo';
import { getReservaActivaDePaquete, getInfoEnvioDePaquete, getInfoEnvioParaPaquetes, type InfoEnvioPaqueteDTO } from '@/lib/envios';
import type { Package, Company, Prisma } from '@prisma/client';
import type { PackageStatus, PaymentStatus } from '@/types';

/**
 * Fase 2.2 — ubicación operativa real de un paquete: si está reservado
 * en un envío BORRADOR/CERRADO hacia otra sucursal, NO está disponible
 * para entregar/enviar a depósito/denegar aquí, sin importar que
 * Package.status siga en "EN_PAQUETERIA" (nunca cambia por Envíos, ver
 * src/lib/envios.ts). Reutiliza exactamente getReservaActivaDePaquete()
 * — la misma función que ya usa el backend de Entrega/Depósito para
 * RECHAZAR la operación — para que el frontend muestre la razón antes
 * de ofrecer un botón que el backend de todos modos va a rechazar.
 */
export interface EnTransitoDTO {
  envioCodigo: string;
  destinoNombre: string;
}

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
  // DESTINATARIO ORIGINAL (Fase 4): registrado en Recepción/Envíos al
  // crear el paquete. A partir de la separación destinatario/quién
  // recoge, Entrega ya NUNCA escribe estos dos campos — son de solo
  // lectura desde el punto de vista de la entrega. Ver
  // quienRecogeNombre/quienRecogeTelefono más abajo para la persona que
  // se presenta físicamente a retirar el paquete.
  destinatario: string | null;
  destinatarioTelefono: string | null;
  // QUIEN RECOGE (Fase 4): capturado únicamente por Entrega al momento
  // de la entrega — columnas propias, independientes de destinatario/
  // destinatarioTelefono (ver Package.quienRecogeNombre en el schema).
  quienRecogeNombre: string | null;
  quienRecogeTelefono: string | null;
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
  // Identidad de ESTA instalación (Fase 1: Company.sucursalNombre — misma
  // fuente que src/lib/envios.ts:getEnvioDetalle(), nunca duplicada).
  origenNombre: string | null;
  // Fase 2.2: null si el paquete está disponible aquí. Si no, viene de
  // getReservaActivaDePaquete() — el paquete está reservado en un envío
  // BORRADOR/CERRADO hacia otra sucursal y el backend de Entrega/Depósito
  // va a rechazar cualquier intento de entregarlo/enviarlo/denegarlo
  // aquí (ver PaqueteEnEnvioError en package-transitions.ts). Solo se
  // calcula en el detalle de UN paquete (toPackageDetailDTO/
  // getPackageDetail) — nunca en toPackageDetailDTOList(), para no
  // convertir cada lista (Reportes/Dashboard) en un N+1.
  enTransito: EnTransitoDTO | null;
  // Fase 4: a diferencia de "enTransito" (solo mientras CERRADO, con
  // mandato de SEGURIDAD — ver getReservaActivaDePaquete()), esto es
  // puramente informativo y persiste también en RECIBIDO: "este paquete
  // llegó/salió alguna vez por una transferencia entre sucursales", para
  // que Buscador/Entrega puedan mostrar "Enviado desde X → Y" incluso
  // después de que el destino ya confirmó la recepción. null si el
  // paquete nunca viajó por Envíos.
  envioInfo: InfoEnvioPaqueteDTO | null;
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
function buildPackageDetailDTO(
  pkg: Package,
  company: Company,
  feriados: Set<string>,
  cliente?: ClienteRelacionado,
  enTransito: EnTransitoDTO | null = null,
  envioInfo: InfoEnvioPaqueteDTO | null = null
): PackageDetailDTO {
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
    quienRecogeNombre: pkg.quienRecogeNombre,
    quienRecogeTelefono: pkg.quienRecogeTelefono,
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
    origenNombre: company.sucursalNombre,
    enTransito,
    envioInfo,
  };
}

export async function toPackageDetailDTO(pkg: Package): Promise<PackageDetailDTO> {
  const [company, feriados, cliente, enTransito, envioInfo] = await Promise.all([
    getCompanyConfig(),
    getHolidaySet(),
    pkg.clienteId ? prisma.cliente.findUnique({ where: { id: pkg.clienteId } }) : Promise.resolve(null),
    getReservaActivaDePaquete(pkg.id),
    getInfoEnvioDePaquete(pkg.id),
  ]);
  return buildPackageDetailDTO(pkg, company, feriados, cliente, enTransito, envioInfo);
}

/**
 * Igual que toPackageDetailDTO pero trayendo la config de empresa y los
 * feriados una sola vez para toda la lista, en vez de una vez por
 * paquete. No incluye datos de cliente (no se usa en vistas de lista) ni
 * "enTransito" (requeriría una consulta extra por fila — ver comentario
 * en PackageDetailDTO — las vistas de lista que usan esto, ej. Reportes/
 * Dashboard, no ofrecen acciones de entrega/depósito). SÍ incluye
 * "envioInfo" (Fase 4): se resuelve con UNA sola consulta agrupada para
 * toda la lista (getInfoEnvioParaPaquetes()), nunca N+1 — así Buscador
 * puede mostrar "Enviado desde X → Y" en sus resultados sin el costo que
 * tendría "enTransito".
 */
export async function toPackageDetailDTOList(pkgs: Package[]): Promise<PackageDetailDTO[]> {
  const [company, feriados, envioInfoPorPaquete] = await Promise.all([
    getCompanyConfig(),
    getHolidaySet(),
    getInfoEnvioParaPaquetes(pkgs.map((p) => p.id)),
  ]);
  return pkgs.map((pkg) => buildPackageDetailDTO(pkg, company, feriados, undefined, null, envioInfoPorPaquete.get(pkg.id) ?? null));
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
