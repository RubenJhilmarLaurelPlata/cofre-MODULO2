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
import { normalizarCodigo } from '@/lib/codigo';
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

const ESTADOS_ACTIVOS = ['BORRADOR', 'CERRADO'] as const;

/**
 * ¿Este paquete está reservado ahora mismo en algún envío (borrador o ya
 * cerrado)? Usado por src/lib/package-transitions.ts como guardia antes
 * de entregar/denegar/enviar a depósito — un envío CANCELADO nunca
 * bloquea nada (sus paquetes ya quedaron libres). No exportamos
 * "cuántos" ni nada más: solo lo estrictamente necesario para bloquear
 * con un mensaje claro.
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
): Promise<{ envioId: string; envioCodigo: string } | null> {
  const item = await client.envioItem.findFirst({
    where: { packageId, envio: { estado: { in: [...ESTADOS_ACTIVOS] } } },
    select: { envioId: true, envio: { select: { codigo: true } } },
  });
  return item ? { envioId: item.envioId, envioCodigo: item.envio.codigo } : null;
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
  items: EnvioItemDTO[];
}

export async function getEnvioDetalle(id: string): Promise<EnvioDetalleDTO> {
  const envio = await prisma.envio.findUnique({
    where: { id },
    include: {
      destino: { select: { id: true, codigo: true, nombre: true, ciudad: true } },
      creadoPor: { select: { nombre: true } },
      cerradoPor: { select: { nombre: true } },
      items: { include: { package: { select: { id: true, code: true, status: true, ingresoAt: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!envio) throw new EnvioNoEncontradoError();

  return {
    ...toEnvioDTO(envio),
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

export async function agregarPaquete(envioId: string, code: string, userId: string): Promise<EnvioDetalleDTO> {
  const codigoNormalizado = normalizarCodigo(code);

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

    const pkg = await tx.package.findUnique({ where: { codigoNormalizado } });
    if (!pkg) throw new PaqueteNoEncontradoParaEnvioError(code);
    if (pkg.status !== 'EN_PAQUETERIA') throw new PaqueteNoElegibleError(pkg.code, pkg.status);

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

export type { EnvioItem };
