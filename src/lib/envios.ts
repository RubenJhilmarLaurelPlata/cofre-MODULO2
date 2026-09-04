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

export interface EnvioItemDTO {
  id: string;
  packageId: string;
  code: string;
  status: string;
  ingresoAt: string;
  createdAt: string;
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
}

export async function getEnvioDetalle(id: string): Promise<EnvioDetalleDTO> {
  const [envio, company] = await Promise.all([
    prisma.envio.findUnique({
      where: { id },
      include: {
        destino: { select: { id: true, codigo: true, nombre: true, ciudad: true } },
        creadoPor: { select: { nombre: true } },
        cerradoPor: { select: { nombre: true } },
        items: { include: { package: { select: { id: true, code: true, status: true, ingresoAt: true } } }, orderBy: { createdAt: 'asc' } },
      },
    }),
    getCompanyConfig(),
  ]);
  if (!envio) throw new EnvioNoEncontradoError();

  return {
    ...toEnvioDTO(envio),
    origen: { codigo: company.sucursalCodigo, nombre: company.sucursalNombre },
    items: envio.items.map((it) => ({
      id: it.id,
      packageId: it.package.id,
      code: it.package.code,
      status: it.package.status,
      ingresoAt: it.package.ingresoAt.toISOString(),
      createdAt: it.createdAt.toISOString(),
    })),
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
 */
export async function agregarPaquete(
  envioId: string,
  code: string,
  userId: string,
  branchId?: string,
  datosRecogida?: Pick<CamposExtraRegistro, 'destinatario' | 'destinatarioTelefono'>
): Promise<EnvioDetalleDTO> {
  const codeCanonico = canonicalizarSeparadores(code.trim()).toUpperCase();
  const codigoNormalizado = normalizarCodigo(codeCanonico);

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

    await tx.envioItem.create({ data: { envioId, packageId: pkg.id } });

    return { envioCodigo: envio.codigo, packageCode: pkg.code };
  }, TRANSACTION_OPTS);

  await registrarAuditoria({ userId, accion: 'ENVIO_PAQUETE_AGREGADO', modulo: 'envios', valorNuevo: { envio: envioCodigo, paquete: packageCode } });

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
 * Busca un envío por su código (lo que el QR codifica — ver
 * src/app/api/envios/[id]/qr/route.ts) para el flujo "Envíos → Recibir
 * envío" (Fase 2.1). Funciona para cualquier estado: CERRADO (listo para
 * recibir) y RECIBIDO (para poder mostrar "ya fue recibido" en vez de un
 * error genérico de "no encontrado") — BORRADOR/CANCELADO nunca tuvieron
 * QR, así que no deberían llegar aquí en la práctica, pero tampoco es un
 * error mostrarlos si alguien escribe el código a mano.
 */
export async function buscarEnvioParaRecibir(codigo: string): Promise<EnvioDetalleDTO | null> {
  const envio = await prisma.envio.findUnique({ where: { codigo: codigo.trim().toUpperCase() }, select: { id: true } });
  if (!envio) return null;
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

export type { EnvioItem };
