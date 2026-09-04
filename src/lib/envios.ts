// src/lib/envios.ts
// Nucleo de dominio del modulo Envios (Fase 2): transferencias LOCALES de
// paquetes hacia otra sucursal — sin comunicacion real entre servidores
// todavia (eso es una fase futura). Mismos principios ya establecidos en
// el resto del proyecto:
//   - Package.status NUNCA cambia por pertenecer a un envio: la
//     exclusividad ("este paquete ya esta reservado") la da la relacion
//     EnvioItem, verificada dentro de la misma transaccion — nunca un
//     estado nuevo de Package.
//   - PackageHistory NUNCA se toca aqui (su "estado" debe seguir
//     representando siempre el Package.status vigente, sin excepciones):
//     los eventos de Envios se registran en AuditLog (modulo 'envios').
//   - Un Envio CERRADO o CANCELADO es inmutable: ninguna funcion de este
//     archivo ofrece editar destino/codigo/qrToken en ningun momento, ni
//     agregar/quitar paquetes fuera de BORRADOR.
//   - codigo se genera al CREAR (nunca cambia despues); qrToken se
//     genera UNA sola vez al CERRAR (nunca se regenera).
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { registrarAuditoria } from '@/lib/auditoria';
import { normalizarCodigo, canonicalizarSeparadores } from '@/lib/codigo';
import { registrarPaqueteBasico, type CamposExtraRegistro } from '@/lib/paquete-registro';
import { getCompanyConfig } from '@/lib/config';
import type { Prisma, Envio, EnvioItem } from '@prisma/client';

export class EnvioNoEncontradoError extends Error {
  constructor() {
    super('No se encontró el envío solicitado.');
    this.name = 'EnvioNoEncontradoError';
  }
}
export class DestinoNoEncontradoError extends Error {
  constructor() {
    super('El destino seleccionado no existe.');
    this.name = 'DestinoNoEncontradoError';
  }
}
export class DestinoInactivoError extends Error {
  constructor() {
    super('El destino seleccionado está desactivado.');
    this.name = 'DestinoInactivoError';
  }
}
export class EnvioNoModificableError extends Error {
  constructor(estado: string) {
    super(`Este envío ya está ${estado === 'CERRADO' ? 'cerrado' : 'cancelado'} y no puede modificarse.`);
    this.name = 'EnvioNoModificableError';
  }
}
export class EnvioVacioError extends Error {
  constructor() {
    super('No se puede cerrar un envío sin paquetes.');
    this.name = 'EnvioVacioError';
  }
}
export class PaqueteNoEncontradoParaEnvioError extends Error {
  constructor(code: string) {
    super(`No se encontró ningún paquete con el código "${code}".`);
    this.name = 'PaqueteNoEncontradoParaEnvioError';
  }
}
export class PaqueteNoElegibleError extends Error {
  constructor(code: string, status: string) {
    super(`El paquete "${code}" no puede agregarse a un envío (estado actual: ${status}). Solo se pueden enviar paquetes "En Paquetería".`);
    this.name = 'PaqueteNoElegibleError';
  }
}
export class PaqueteYaReservadoError extends Error {
  constructor(code: string, envioCodigo: string) {
    super(`El paquete "${code}" ya está en el envío ${envioCodigo}. Quítalo de ahí antes de agregarlo a otro.`);
    this.name = 'PaqueteYaReservadoError';
  }
}
export class PaqueteNoEnEsteEnvioError extends Error {
  constructor() {
    super('Ese paquete no pertenece a este envío.');
    this.name = 'PaqueteNoEnEsteEnvioError';
  }
}
export class EnvioNoRecibibleError extends Error {
  constructor(estado: string) {
    super(
      estado === 'RECIBIDO'
        ? 'Este envío ya fue recibido anteriormente.'
        : 'Solo se pueden recibir envíos cerrados (con su QR ya generado).'
    );
    this.name = 'EnvioNoRecibibleError';
  }
}
export class MontoPagoRequeridoError extends Error {
  constructor() {
    super('Indica el monto que se cobró para poder marcar este paquete como pagado.');
    this.name = 'MontoPagoRequeridoError';
  }
}
export class ItemNoEditableError extends Error {
  constructor() {
    super('Solo se puede corregir el pago de un paquete mientras el envío sigue en borrador.');
    this.name = 'ItemNoEditableError';
  }
}
export class NoHayFondosPendientesError extends Error {
  constructor() {
    super('No hay fondos pendientes de liquidar para este destino.');
    this.name = 'NoHayFondosPendientesError';
  }
}

const ESTADOS_ACTIVOS = ['BORRADOR', 'CERRADO'] as const;

/**
 * ¿Este paquete está actualmente EN TRÁNSITO hacia otra sucursal? — es
 * decir, en un envío ya CERRADO (despachado) que todavía no fue
 * recibido en destino. Usado por src/lib/package-transitions.ts como
 * guardia antes de entregar/denegar/enviar a depósito, y por
 * src/lib/package-detail.ts para mostrar el motivo (Fase 2.2, regla
 * fundamental: "una sucursal solo puede entregar paquetes que
 * actualmente estén disponibles en ella"). Un envío CANCELADO nunca
 * bloquea nada (sus paquetes ya quedaron libres); un envío RECIBIDO
 * tampoco (ya está disponible en destino — ver recibirEnvio()).
 *
 * A propósito NO incluye BORRADOR: mientras el envío todavía se está
 * preparando, el paquete sigue físicamente en esta sucursal — recién
 * "sale" cuando se cierra (cerrarEnvio). La exclusividad de "no puede
 * estar en dos envíos a la vez" (que sí debe incluir BORRADOR) es una
 * regla aparte, ver ESTADOS_ACTIVOS/agregarPaquete() más abajo — nunca
 * se mezclan estos dos chequeos aunque compartan la misma tabla.
 *
 * Acepta un `client` opcional (el `tx` de una transacción en curso) para
 * que el llamador pueda ejecutar este chequeo DENTRO de la misma
 * transacción atómica que hace la transición de estado — igual que
 * agregarPaquete() ya hace con su propio chequeo de reserva. Sin esto,
 * un chequeo "de antemano" (conexión aparte, liberada antes de abrir la
 * transacción de la transición) deja una ventana real donde otra
 * request puede colar un agregarPaquete() para el mismo paquete entre
 * el chequeo y la transición — bajo connection_limit=1 esa ventana
 * existe porque cada `await` a una consulta suelta libera la única
 * conexión hasta el siguiente `await`, no la retiene indefinidamente.
 */
export async function getReservaActivaDePaquete(
  packageId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ envioId: string; envioCodigo: string; destinoNombre: string } | null> {
  const item = await client.envioItem.findFirst({
    where: { packageId, envio: { estado: 'CERRADO' } },
    select: { envioId: true, envio: { select: { codigo: true, destino: { select: { nombre: true } } } } },
  });
  return item ? { envioId: item.envioId, envioCodigo: item.envio.codigo, destinoNombre: item.envio.destino.nombre } : null;
}

export interface InfoEnvioPaqueteDTO {
  envioId: string;
  envioCodigo: string;
  estado: 'CERRADO' | 'RECIBIDO';
  origenCodigo: string | null;
  origenNombre: string | null;
  destinoCodigo: string;
  destinoNombre: string;
}

/**
 * Fase 4 (auditoría Envíos/Recepción/Buscador/Entrega): a diferencia de
 * getReservaActivaDePaquete() (arriba) — que es CERRADO-only y es la
 * única función con mandato de SEGURIDAD (bloquear entrega/depósito/
 * denegar, ver package-transitions.ts) — esta es puramente informativa:
 * "¿este paquete viajó alguna vez por un envío ya despachado?", incluye
 * también RECIBIDO para poder seguir mostrando "Enviado desde X → Y" de
 * forma persistente después de que el destino confirmó la recepción (sin
 * esto, la identidad intersucursal del paquete desaparecía visualmente
 * apenas se recibía, aunque siguiera siendo la misma transferencia).
 * Nunca se usa para decidir si algo se puede entregar — eso sigue siendo
 * exclusivo de getReservaActivaDePaquete().
 *
 * origen/destino se derivan de Company.sucursalCodigo/sucursalNombre y
 * SucursalDestino (nunca un valor fijo) — mismo criterio que
 * getEnvioDetalle(). BORRADOR/CANCELADO nunca aparecen aquí: un envío
 * BORRADOR no salió todavía, uno CANCELADO nunca llegó a salir.
 */
export async function getInfoEnvioDePaquete(packageId: string): Promise<InfoEnvioPaqueteDTO | null> {
  const [item, company] = await Promise.all([
    prisma.envioItem.findFirst({
      where: { packageId, envio: { estado: { in: ['CERRADO', 'RECIBIDO'] } } },
      select: { envioId: true, envio: { select: { codigo: true, estado: true, destino: { select: { codigo: true, nombre: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    getCompanyConfig(),
  ]);
  if (!item) return null;
  return {
    envioId: item.envioId,
    envioCodigo: item.envio.codigo,
    estado: item.envio.estado as 'CERRADO' | 'RECIBIDO',
    origenCodigo: company.sucursalCodigo,
    origenNombre: company.sucursalNombre,
    destinoCodigo: item.envio.destino.codigo,
    destinoNombre: item.envio.destino.nombre,
  };
}

/**
 * Igual que getInfoEnvioDePaquete() pero en lote — una sola consulta
 * agrupada para varios paquetes, en vez de una por fila (mismo criterio
 * ya usado en getFondosPendientesPorDestino()) — así Buscador puede
 * mostrar "Origen → Destino" en una lista de resultados sin convertirla
 * en un N+1.
 */
export async function getInfoEnvioParaPaquetes(packageIds: string[]): Promise<Map<string, InfoEnvioPaqueteDTO>> {
  if (packageIds.length === 0) return new Map();
  const [items, company] = await Promise.all([
    prisma.envioItem.findMany({
      where: { packageId: { in: packageIds }, envio: { estado: { in: ['CERRADO', 'RECIBIDO'] } } },
      select: { envioId: true, packageId: true, createdAt: true, envio: { select: { codigo: true, estado: true, destino: { select: { codigo: true, nombre: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    getCompanyConfig(),
  ]);

  const porPaquete = new Map<string, InfoEnvioPaqueteDTO>();
  for (const item of items) {
    // orderBy desc + "solo la primera vez que se ve este packageId":
    // si un paquete tuviera más de un EnvioItem histórico (no debería en
    // el flujo normal), se queda con el más reciente.
    if (porPaquete.has(item.packageId)) continue;
    porPaquete.set(item.packageId, {
      envioId: item.envioId,
      envioCodigo: item.envio.codigo,
      estado: item.envio.estado as 'CERRADO' | 'RECIBIDO',
      origenCodigo: company.sucursalCodigo,
      origenNombre: company.sucursalNombre,
      destinoCodigo: item.envio.destino.codigo,
      destinoNombre: item.envio.destino.nombre,
    });
  }
  return porPaquete;
}

// crypto.randomUUID() es un global de Node/Edge (sin import de
// "node:crypto"): evita que este archivo arrastre un modulo built-in de
// Node hacia el bundle del cliente cuando se importa transitivamente
// desde codigo compartido con componentes 'use client' (ver
// package-transitions.ts -> finanzas.ts -> reportes.ts/dashboard-data.ts
// -> componentes cliente) — mismo motivo por el que aca nunca se usa
// `import ... from 'node:crypto'` directamente.
function generarQrToken(): string {
  return crypto.randomUUID();
}

/** "ENV-20260904-001" — independiente de cualquier sucursal, nunca asume LPZ/ELA/ninguna en particular. */
async function generarCodigoEnvio(tx: Prisma.TransactionClient): Promise<string> {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  const prefijo = `ENV-${yyyy}${mm}${dd}-`;
  const cantidadHoy = await tx.envio.count({ where: { codigo: { startsWith: prefijo } } });
  const secuencia = String(cantidadHoy + 1).padStart(3, '0');
  return `${prefijo}${secuencia}`;
}

export interface EnvioDTO {
  id: string;
  codigo: string;
  estado: string;
  destino: { id: string; codigo: string; nombre: string; ciudad: string | null };
  cantidadPaquetes: number;
  creadoPor: string | null;
  cerradoPor: string | null;
  createdAt: string;
  cerradoAt: string | null;
  qrToken: string | null;
}

function toEnvioDTO(e: Envio & { destino: { id: string; codigo: string; nombre: string; ciudad: string | null }; items: unknown[]; creadoPor: { nombre: string } | null; cerradoPor: { nombre: string } | null }): EnvioDTO {
  return {
    id: e.id,
    codigo: e.codigo,
    estado: e.estado,
    destino: e.destino,
    cantidadPaquetes: e.items.length,
    creadoPor: e.creadoPor?.nombre ?? null,
    cerradoPor: e.cerradoPor?.nombre ?? null,
    createdAt: e.createdAt.toISOString(),
    cerradoAt: e.cerradoAt ? e.cerradoAt.toISOString() : null,
    qrToken: e.qrToken,
  };
}

const INCLUDE_LISTA = {
  destino: { select: { id: true, codigo: true, nombre: true, ciudad: true } },
  items: { select: { id: true } },
  creadoPor: { select: { nombre: true } },
  cerradoPor: { select: { nombre: true } },
} satisfies Prisma.EnvioInclude;

export interface FiltrosEnvios {
  estado?: string;
  destinoId?: string;
  q?: string; // busqueda por codigo
}

export async function listarEnvios(filtros: FiltrosEnvios): Promise<EnvioDTO[]> {
  const where: Prisma.EnvioWhereInput = {};
  if (filtros.estado) where.estado = filtros.estado;
  if (filtros.destinoId) where.destinoId = filtros.destinoId;
  if (filtros.q) where.codigo = { contains: filtros.q.trim().toUpperCase() };

  const envios = await prisma.envio.findMany({ where, include: INCLUDE_LISTA, orderBy: { createdAt: 'desc' }, take: 200 });
  return envios.map(toEnvioDTO);
}

export type EstadoPagoEnvioItem = 'PENDIENTE' | 'PAGADO';

// Lo que el operador declara al agregar/corregir un paquete (Fase 3: pago
// por paquete). "monto" es el efectivo que el cliente realmente entregó en
// ORIGEN por este paquete — nunca un cálculo de tarifa (ver comentario de
// EnvioItem.montoPagado en el schema): la tarifa de la sucursal destino no
// es visible desde aquí. Obligatorio y > 0 solo cuando estadoPago='PAGADO'
// (validado en agregarPaquete()/actualizarPagoItem()).
export interface PagoEnvioItemInput {
  estadoPago: EstadoPagoEnvioItem;
  monto?: number;
}

function validarPago(pago?: PagoEnvioItemInput): { estadoPago: EstadoPagoEnvioItem; montoPagado: number } {
  if (!pago || pago.estadoPago === 'PENDIENTE') return { estadoPago: 'PENDIENTE', montoPagado: 0 };
  if (!pago.monto || pago.monto <= 0) throw new MontoPagoRequeridoError();
  return { estadoPago: 'PAGADO', montoPagado: Math.round(pago.monto * 100) / 100 };
}

export interface EnvioItemDTO {
  id: string;
  packageId: string;
  code: string;
  status: string;
  ingresoAt: string;
  createdAt: string;
  // Fase 3: mismos campos que ya usa Recepción/Entrega (Package.destinatario/
  // destinatarioTelefono), nunca una estructura paralela — ver
  // registrarPaqueteBasico()/agregarPaquete().
  destinatario: string | null;
  destinatarioTelefono: string | null;
  estadoPago: EstadoPagoEnvioItem;
  montoPagado: number;
}

export interface ResumenPagoEnvio {
  pagados: number;
  pendientes: number;
  fondosDestino: number;
}

function calcularResumenPago(items: Pick<EnvioItemDTO, 'estadoPago' | 'montoPagado'>[]): ResumenPagoEnvio {
  const pagados = items.filter((it) => it.estadoPago === 'PAGADO').length;
  const fondosDestino = Math.round(items.reduce((acc, it) => acc + (it.estadoPago === 'PAGADO' ? it.montoPagado : 0), 0) * 100) / 100;
  return { pagados, pendientes: items.length - pagados, fondosDestino };
}

export interface EnvioDetalleDTO extends EnvioDTO {
  // Identidad de ESTA instalación (Fase 1: Company.sucursalCodigo/
  // sucursalNombre — nunca una segunda fuente de verdad ni un valor
  // hardcodeado). Se arma UNA sola vez, aquí, para que toda función que
  // devuelve un EnvioDetalleDTO (crearEnvio, agregarPaquete, quitarPaquete,
  // cerrarEnvio, cancelarEnvio, recibirEnvio, getEnvioDetalle) lo incluya
  // siempre de la misma forma — ningún endpoint tiene que acordarse de
  // adjuntarlo por su cuenta (esa inconsistencia fue exactamente el bug
  // "envio.origen.nombre" de la ronda anterior: solo el GET inicial lo
  // adjuntaba, y el estado del cliente quedaba sin "origen" después de
  // cualquier otra acción).
  origen: { codigo: string | null; nombre: string | null };
  items: EnvioItemDTO[];
  // Fase 3: derivado en vivo de "items" (nunca almacenado — mismo criterio
  // que "saldoPendiente" en package-detail.ts), para que el cliente nunca
  // tenga que sumarlo a mano.
  resumenPago: ResumenPagoEnvio;
}

export async function getEnvioDetalle(id: string): Promise<EnvioDetalleDTO> {
  const [envio, company] = await Promise.all([
    prisma.envio.findUnique({
      where: { id },
      include: {
        destino: { select: { id: true, codigo: true, nombre: true, ciudad: true } },
        creadoPor: { select: { nombre: true } },
        cerradoPor: { select: { nombre: true } },
        items: {
          include: { package: { select: { id: true, code: true, status: true, ingresoAt: true, destinatario: true, destinatarioTelefono: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    getCompanyConfig(),
  ]);
  if (!envio) throw new EnvioNoEncontradoError();

  const items: EnvioItemDTO[] = envio.items.map((it) => ({
    id: it.id,
    packageId: it.package.id,
    code: it.package.code,
    status: it.package.status,
    ingresoAt: it.package.ingresoAt.toISOString(),
    createdAt: it.createdAt.toISOString(),
    destinatario: it.package.destinatario,
    destinatarioTelefono: it.package.destinatarioTelefono,
    estadoPago: it.estadoPago as EstadoPagoEnvioItem,
    montoPagado: it.montoPagado,
  }));

  return {
    ...toEnvioDTO(envio),
    origen: { codigo: company.sucursalCodigo, nombre: company.sucursalNombre },
    items,
    resumenPago: calcularResumenPago(items),
  };
}

export async function crearEnvio(destinoId: string, userId: string): Promise<EnvioDetalleDTO> {
  const destino = await prisma.sucursalDestino.findUnique({ where: { id: destinoId } });
  if (!destino) throw new DestinoNoEncontradoError();
  if (!destino.activa) throw new DestinoInactivoError();

  const envio = await prisma.$transaction(async (tx) => {
    const codigo = await generarCodigoEnvio(tx);
    return tx.envio.create({ data: { codigo, destinoId, estado: 'BORRADOR', creadoPorId: userId } });
  }, TRANSACTION_OPTS);

  await registrarAuditoria({
    userId,
    accion: 'ENVIO_CREADO',
    modulo: 'envios',
    valorNuevo: { codigo: envio.codigo, destino: destino.nombre },
  });

  return getEnvioDetalle(envio.id);
}

/**
 * Agrega un paquete a un envío en BORRADOR. Fase 2.1: si el código
 * escaneado todavía no existe como paquete (nunca pasó por Recepción),
 * y se recibió `branchId`, se registra en el acto — mismo alta mínima
 * que Recepción (ver registrarPaqueteBasico()) — y se reserva en este
 * envío en la MISMA transacción: un solo escaneo hace las dos cosas,
 * sin ventana de carrera entre "crear" y "reservar". Si no se recibió
 * `branchId` (ej. los tests, que siempre operan sobre paquetes ya
 * creados), un código inexistente sigue rechazándose como antes.
 *
 * `datosRecogida` (nombre/teléfono de quien recogerá — Fase 2.1,
 * corrección final): reutiliza EXACTAMENTE los mismos campos que
 * Recepción ya usa para esto (Package.destinatario/destinatarioTelefono
 * — ver recepcion/scan/route.ts), nunca una estructura paralela. Solo se
 * aplican cuando el paquete se registra en este mismo llamado — si el
 * paquete YA existía, se ignoran por completo (nunca sobrescriben datos
 * ya guardados; quien quiera completarlos ahí usa Entrega/Recepción,
 * igual que hoy).
 *
 * `pago` (Fase 3 — dinero cobrado en origen para el destino): se guarda
 * en EnvioItem.estadoPago/montoPagado, nunca en Package.montoPagado/Pago
 * (ver comentario de EnvioItem en el schema) — así el dinero de otra
 * sucursal nunca infla los ingresos propios de esta.
 */
export async function agregarPaquete(
  envioId: string,
  code: string,
  userId: string,
  branchId?: string,
  datosRecogida?: Pick<CamposExtraRegistro, 'destinatario' | 'destinatarioTelefono'>,
  pago?: PagoEnvioItemInput
): Promise<EnvioDetalleDTO> {
  const codeCanonico = canonicalizarSeparadores(code.trim()).toUpperCase();
  const codigoNormalizado = normalizarCodigo(codeCanonico);
  const { estadoPago, montoPagado } = validarPago(pago);

  // registrarAuditoria() usa el cliente `prisma` de nivel superior, nunca
  // `tx` — con connection_limit=1 llamarla DESDE DENTRO de esta
  // transaccion interactiva se bloquea para siempre (la unica conexion ya
  // esta tomada por la transaccion en curso). Mismo motivo ya documentado
  // en registrarPagoEnTx()/package-transitions.ts: se audita DESPUES de
  // que la transaccion confirmo, nunca adentro.
  const { envioCodigo, packageCode } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new EnvioNoModificableError(envio.estado);

    let pkg = await tx.package.findUnique({ where: { codigoNormalizado } });
    if (!pkg) {
      if (!branchId) throw new PaqueteNoEncontradoParaEnvioError(code);
      pkg = await registrarPaqueteBasico(tx, codeCanonico, branchId, userId, {}, {
        destinatario: datosRecogida?.destinatario || null,
        destinatarioTelefono: datosRecogida?.destinatarioTelefono || null,
      });
    } else if (pkg.status !== 'EN_PAQUETERIA') {
      throw new PaqueteNoElegibleError(pkg.code, pkg.status);
    }

    const reservaActiva = await tx.envioItem.findFirst({
      where: { packageId: pkg.id, envio: { estado: { in: [...ESTADOS_ACTIVOS] } } },
      select: { envio: { select: { codigo: true } } },
    });
    if (reservaActiva) throw new PaqueteYaReservadoError(pkg.code, reservaActiva.envio.codigo);

    await tx.envioItem.create({ data: { envioId, packageId: pkg.id, estadoPago, montoPagado } });

    return { envioCodigo: envio.codigo, packageCode: pkg.code };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_PAQUETE_AGREGADO', modulo: 'envios', valorNuevo: { envio: envioCodigo, paquete: packageCode, estadoPago, montoPagado } });

  return getEnvioDetalle(envioId);
}

/**
 * Corrige el pago declarado de un paquete ya agregado (Fase 3), solo
 * mientras el envío sigue en BORRADOR — mismo guard que quitarPaquete().
 * Nunca se usa después de CERRADO: un envío cerrado es inmutable, igual
 * que el resto de este módulo.
 */
export async function actualizarPagoItem(envioId: string, packageId: string, pago: PagoEnvioItemInput, userId: string): Promise<EnvioDetalleDTO> {
  const { estadoPago, montoPagado } = validarPago(pago);

  const { envioCodigo, packageCode } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new ItemNoEditableError();

    const item = await tx.envioItem.findUnique({ where: { envioId_packageId: { envioId, packageId } }, include: { package: { select: { code: true } } } });
    if (!item) throw new PaqueteNoEnEsteEnvioError();

    await tx.envioItem.update({ where: { id: item.id }, data: { estadoPago, montoPagado } });

    return { envioCodigo: envio.codigo, packageCode: item.package.code };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_PAGO_ACTUALIZADO', modulo: 'envios', valorNuevo: { envio: envioCodigo, paquete: packageCode, estadoPago, montoPagado } });

  return getEnvioDetalle(envioId);
}

/**
 * Corrige el destinatario original (nombre/teléfono de quien recogerá)
 * de un paquete ya agregado, mientras el envío sigue en BORRADOR — mismo
 * guard que actualizarPagoItem(). Fase 4 (auditoría): arregla la causa
 * raíz real de "los datos de quien recoge desaparecen" — un lector físico
 * puede disparar agregarPaquete() en Enter antes de que el operador
 * termine de escribir nombre/teléfono (o el código ya existía, caso en el
 * que agregarPaquete() a propósito NUNCA sobrescribe datos ya guardados —
 * ver su comentario), y hasta ahora no había ninguna forma explícita de
 * corregirlo sin quitar y volver a agregar el paquete. Escribe
 * directamente en Package.destinatario/destinatarioTelefono — son las
 * columnas correctas para esto (el destinatario ORIGINAL, distinto de
 * "quién recoge" en Entrega — ver Package.quienRecogeNombre/
 * quienRecogeTelefono en el schema, que Envíos nunca toca).
 */
export async function actualizarDatosRecogidaItem(
  envioId: string,
  packageId: string,
  datos: Pick<CamposExtraRegistro, 'destinatario' | 'destinatarioTelefono'>,
  userId: string
): Promise<EnvioDetalleDTO> {
  const destinatario = datos.destinatario?.trim() || null;
  const destinatarioTelefono = datos.destinatarioTelefono?.trim() || null;

  const { envioCodigo, packageCode } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new ItemNoEditableError();

    const item = await tx.envioItem.findUnique({ where: { envioId_packageId: { envioId, packageId } }, include: { package: { select: { code: true } } } });
    if (!item) throw new PaqueteNoEnEsteEnvioError();

    await tx.package.update({ where: { id: packageId }, data: { destinatario, destinatarioTelefono } });

    return { envioCodigo: envio.codigo, packageCode: item.package.code };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_DESTINATARIO_ACTUALIZADO', modulo: 'envios', valorNuevo: { envio: envioCodigo, paquete: packageCode, destinatario, destinatarioTelefono } });

  return getEnvioDetalle(envioId);
}

export async function quitarPaquete(envioId: string, packageId: string, userId: string): Promise<EnvioDetalleDTO> {
  const { envioCodigo, packageCode } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new EnvioNoModificableError(envio.estado);

    const item = await tx.envioItem.findUnique({ where: { envioId_packageId: { envioId, packageId } }, include: { package: { select: { code: true } } } });
    if (!item) throw new PaqueteNoEnEsteEnvioError();

    await tx.envioItem.delete({ where: { id: item.id } });

    return { envioCodigo: envio.codigo, packageCode: item.package.code };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_PAQUETE_QUITADO', modulo: 'envios', valorNuevo: { envio: envioCodigo, paquete: packageCode } });

  return getEnvioDetalle(envioId);
}

export async function cerrarEnvio(envioId: string, userId: string): Promise<EnvioDetalleDTO> {
  const { envioCodigo, cantidadPaquetes } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId }, include: { items: { select: { id: true } } } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new EnvioNoModificableError(envio.estado);
    if (envio.items.length === 0) throw new EnvioVacioError();

    const qrToken = generarQrToken();
    // updateMany condicionado al estado anterior: misma protección
    // optimista contra doble-cierre concurrente que ya usa transicionar()
    // en package-transitions.ts.
    const resultado = await tx.envio.updateMany({
      where: { id: envioId, estado: 'BORRADOR' },
      data: { estado: 'CERRADO', qrToken, cerradoAt: new Date(), cerradoPorId: userId },
    });
    if (resultado.count === 0) throw new EnvioNoModificableError('CERRADO');

    return { envioCodigo: envio.codigo, cantidadPaquetes: envio.items.length };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_CERRADO', modulo: 'envios', valorNuevo: { codigo: envioCodigo, cantidadPaquetes } });

  return getEnvioDetalle(envioId);
}

export async function cancelarEnvio(envioId: string, userId: string): Promise<EnvioDetalleDTO> {
  const envioCodigo = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'BORRADOR') throw new EnvioNoModificableError(envio.estado);

    const resultado = await tx.envio.updateMany({ where: { id: envioId, estado: 'BORRADOR' }, data: { estado: 'CANCELADO' } });
    if (resultado.count === 0) throw new EnvioNoModificableError('CANCELADO');

    return envio.codigo;
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_CANCELADO', modulo: 'envios', valorNuevo: { codigo: envioCodigo } });

  return getEnvioDetalle(envioId);
}

/**
 * Busca un envío para el flujo "Envíos → Recibir envío" (Fase 2.1/2.3) — la
 * ÚNICA función de resolución, usada tanto por la cámara (QR) como por la
 * entrada manual (ver recibir-envio-client.tsx: ambos caminos llaman a
 * GET /api/envios/buscar, que llama a esto), para que nunca puedan
 * desincronizarse.
 *
 * Acepta dos formatos de entrada:
 *  - "ENV-20260904-004"                 → solo el código visible (entrada
 *    manual, o un QR viejo/reimpreso). Funciona igual que siempre.
 *  - "ENV-20260904-004|<qrToken>"       → código + token seguro (Fase 3:
 *    lo que ahora codifica el QR real, ver qr/route.ts). Si el token no
 *    coincide con el qrToken guardado, se trata como "no encontrado" — un
 *    código visible por sí solo (fácil de adivinar/copiar) ya NO alcanza
 *    para resolver un envío por esta vía si el que escanea llegó con un
 *    payload de token y este no calza.
 *
 * Funciona para cualquier estado: CERRADO (listo para recibir) y RECIBIDO
 * (para poder mostrar "ya fue recibido" en vez de un error genérico de "no
 * encontrado") — BORRADOR/CANCELADO nunca tuvieron QR, así que no deberían
 * llegar aquí en la práctica, pero tampoco es un error mostrarlos si
 * alguien escribe el código a mano.
 */
export async function buscarEnvioParaRecibir(input: string): Promise<EnvioDetalleDTO | null> {
  const raw = input.trim();
  const separador = raw.indexOf('|');
  const codigo = (separador === -1 ? raw : raw.slice(0, separador)).toUpperCase();
  const tokenEsperado = separador === -1 ? null : raw.slice(separador + 1).trim();

  const envio = await prisma.envio.findUnique({ where: { codigo }, select: { id: true, qrToken: true } });
  if (!envio) return null;
  if (tokenEsperado !== null && envio.qrToken !== tokenEsperado) return null;
  return getEnvioDetalle(envio.id);
}

/**
 * Confirma la recepción de un envío CERRADO (Fase 2.1). Solo cambia
 * Envio.estado a RECIBIDO — nunca Package.status, mismo principio que el
 * resto de este módulo: hoy esta instalación y la "sucursal destino" son
 * la MISMA base de datos (no existe todavía comunicación real entre
 * servidores), así que no hay ningún paquete "ajeno" que dar de alta
 * aquí; esto solo cierra el ciclo de vida del envío mismo. La protección
 * optimista (`estado: 'CERRADO'` en el where) evita recibir el mismo
 * envío dos veces, igual que cerrarEnvio()/cancelarEnvio().
 */
export async function recibirEnvio(envioId: string, userId: string): Promise<EnvioDetalleDTO> {
  const { envioCodigo, cantidadPaquetes } = await prisma.$transaction(async (tx) => {
    const envio = await tx.envio.findUnique({ where: { id: envioId }, include: { items: { select: { id: true } } } });
    if (!envio) throw new EnvioNoEncontradoError();
    if (envio.estado !== 'CERRADO') throw new EnvioNoRecibibleError(envio.estado);

    const resultado = await tx.envio.updateMany({ where: { id: envioId, estado: 'CERRADO' }, data: { estado: 'RECIBIDO' } });
    if (resultado.count === 0) throw new EnvioNoRecibibleError('RECIBIDO');

    return { envioCodigo: envio.codigo, cantidadPaquetes: envio.items.length };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_RECIBIDO', modulo: 'envios', valorNuevo: { codigo: envioCodigo, cantidadPaquetes } });

  return getEnvioDetalle(envioId);
}

// ---------------------------------------------------------------------
// Fondos entre sucursales y liquidación (Fase 3)
// ---------------------------------------------------------------------

export interface FondoPorDestinoDTO {
  destinoId: string;
  destinoCodigo: string;
  destinoNombre: string;
  fondosPendientes: number;
  cantidadEnvios: number;
}

/**
 * Dinero cobrado en ESTA instalación por paquetes destinados a otra
 * sucursal, todavía no entregado físicamente a esa sucursal (ver
 * registrarLiquidacion() más abajo). Solo cuenta envíos ya CERRADOS o
 * RECIBIDOS — un BORRADOR todavía no "salió" de aquí (mismo criterio que
 * getReservaActivaDePaquete()) y uno CANCELADO nunca cobró nada en firme —
 * y solo ítems marcados PAGADO (los PENDIENTE no son fondos de nadie
 * todavía). Nunca toca Pago/Package.montoPagado — ver comentario de
 * EnvioItem en el schema.
 */
export async function getFondosPendientesPorDestino(): Promise<FondoPorDestinoDTO[]> {
  const items = await prisma.envioItem.findMany({
    where: { estadoPago: 'PAGADO', envio: { estado: { in: ['CERRADO', 'RECIBIDO'] }, liquidacionId: null } },
    select: { montoPagado: true, envio: { select: { id: true, destino: { select: { id: true, codigo: true, nombre: true } } } } },
  });

  const porDestino = new Map<string, FondoPorDestinoDTO & { envioIds: Set<string> }>();
  for (const item of items) {
    const d = item.envio.destino;
    let acc = porDestino.get(d.id);
    if (!acc) {
      acc = { destinoId: d.id, destinoCodigo: d.codigo, destinoNombre: d.nombre, fondosPendientes: 0, cantidadEnvios: 0, envioIds: new Set() };
      porDestino.set(d.id, acc);
    }
    acc.fondosPendientes = Math.round((acc.fondosPendientes + item.montoPagado) * 100) / 100;
    acc.envioIds.add(item.envio.id);
  }

  return Array.from(porDestino.values())
    .map((d) => ({ destinoId: d.destinoId, destinoCodigo: d.destinoCodigo, destinoNombre: d.destinoNombre, fondosPendientes: d.fondosPendientes, cantidadEnvios: d.envioIds.size }))
    .sort((a, b) => b.fondosPendientes - a.fondosPendientes);
}

export interface LiquidacionDTO {
  id: string;
  destino: { id: string; codigo: string; nombre: string };
  monto: number;
  usuario: string | null;
  notas: string | null;
  createdAt: string;
  cantidadEnvios: number;
}

function toLiquidacionDTO(l: {
  id: string;
  monto: number;
  notas: string | null;
  createdAt: Date;
  destino: { id: string; codigo: string; nombre: string };
  user: { nombre: string } | null;
  envios: { id: string }[];
}): LiquidacionDTO {
  return {
    id: l.id,
    destino: l.destino,
    monto: l.monto,
    usuario: l.user?.nombre ?? null,
    notas: l.notas,
    createdAt: l.createdAt.toISOString(),
    cantidadEnvios: l.envios.length,
  };
}

/**
 * Registra que esta instalación entregó físicamente a la sucursal destino
 * el efectivo pendiente (ver getFondosPendientesPorDestino()) — NO una
 * transferencia bancaria, es la trazabilidad de una entrega de dinero en
 * efectivo. Toma los envíos CERRADOS/RECIBIDOS de ese destino que todavía
 * no estén en ninguna liquidación Y que tengan al menos un ítem PAGADO
 * (fondosDestino > 0 — un envío sin nada pagado no tiene dinero que
 * entregar, así que no debe quedar asociado a una liquidación por
 * trazabilidad: cada LiquidacionEnvio.envios[] debe representar
 * exactamente qué envíos entregaron el efectivo, no "todo lo que estaba
 * pendiente de marcar"), congela la suma de sus ítems pagados en "monto",
 * y los marca liquidados en la MISMA transacción — así un segundo llamado
 * inmediato nunca puede volver a contar los mismos envíos (mismo
 * principio de atomicidad que el resto del módulo). Un envío sin fondos
 * simplemente queda sin liquidacionId hasta que algún ítem suyo se marque
 * PAGADO — nunca bloquea ni se "pierde".
 */
export async function registrarLiquidacion(destinoId: string, userId: string, notas?: string): Promise<LiquidacionDTO> {
  const destino = await prisma.sucursalDestino.findUnique({ where: { id: destinoId } });
  if (!destino) throw new DestinoNoEncontradoError();

  const liquidacionId = await prisma.$transaction(async (tx) => {
    const candidatos = await tx.envio.findMany({
      where: { destinoId, estado: { in: ['CERRADO', 'RECIBIDO'] }, liquidacionId: null },
      select: { id: true, items: { where: { estadoPago: 'PAGADO' }, select: { montoPagado: true } } },
    });
    // Solo envíos con fondosDestino > 0 — ver comentario de la función.
    const envios = candidatos
      .map((e) => ({ id: e.id, montoEnvio: Math.round(e.items.reduce((s, it) => s + it.montoPagado, 0) * 100) / 100 }))
      .filter((e) => e.montoEnvio > 0);
    const envioIds = envios.map((e) => e.id);
    const monto = Math.round(envios.reduce((acc, e) => acc + e.montoEnvio, 0) * 100) / 100;
    if (monto <= 0 || envioIds.length === 0) throw new NoHayFondosPendientesError();

    const liquidacion = await tx.liquidacionEnvio.create({
      data: { destinoId, monto, userId, notas: notas?.trim() || null },
    });
    await tx.envio.updateMany({ where: { id: { in: envioIds } }, data: { liquidacionId: liquidacion.id } });

    return liquidacion.id;
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'LIQUIDACION_REGISTRADA', modulo: 'envios', valorNuevo: { destino: destino.nombre, liquidacionId } });

  const liquidacion = await prisma.liquidacionEnvio.findUniqueOrThrow({
    where: { id: liquidacionId },
    include: { destino: { select: { id: true, codigo: true, nombre: true } }, user: { select: { nombre: true } }, envios: { select: { id: true } } },
  });
  return toLiquidacionDTO(liquidacion);
}

export async function listarLiquidaciones(destinoId?: string): Promise<LiquidacionDTO[]> {
  const liquidaciones = await prisma.liquidacionEnvio.findMany({
    where: destinoId ? { destinoId } : {},
    include: { destino: { select: { id: true, codigo: true, nombre: true } }, user: { select: { nombre: true } }, envios: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return liquidaciones.map(toLiquidacionDTO);
}

export type { EnvioItem };
