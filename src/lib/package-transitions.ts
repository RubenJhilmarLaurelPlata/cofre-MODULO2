// src/lib/package-transitions.ts
// Reglas de transicion de estado de un paquete, en un solo lugar para que
// Entrega y Deposito (proximo modulo) usen exactamente la misma logica en
// vez de reimplementarla cada uno por su lado.

import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { registrarAuditoria } from '@/lib/auditoria';
import { normalizarCodigo } from '@/lib/codigo';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { fechaReferencia } from '@/lib/package-detail';
import type { Package, Prisma } from '@prisma/client';
import type { PackageStatus, PaymentStatus, MotivoEntregaExcepcional } from '@/types';
import { MOTIVO_ENTREGA_EXCEPCIONAL_LABEL } from '@/types';

export class TransicionInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransicionInvalidaError';
  }
}

export class PaqueteNoEncontradoError extends Error {
  constructor(code: string) {
    super(`No se encontró ningún paquete con el código "${code}".`);
    this.name = 'PaqueteNoEncontradoError';
  }
}

async function buscarOFallar(code: string): Promise<Package> {
  const pkg = await prisma.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(code) } });
  if (!pkg) throw new PaqueteNoEncontradoError(code);
  return pkg;
}

async function transicionar(
  pkg: Package,
  nuevoEstado: PackageStatus,
  userId: string,
  camposExtra: Record<string, unknown>,
  nota?: string
): Promise<Package> {
  const now = new Date();
  const estadoAnterior = pkg.status;
  const actualizado = await prisma.$transaction(async (tx) => {
    // "where: status: estadoAnterior" es la protección contra doble
    // entrega/doble transición: si dos requests casi simultáneas leyeron
    // el mismo paquete "En Paquetería" y ambas intentan entregarlo, solo
    // la primera encuentra una fila que coincide (count 1); la segunda
    // encuentra 0 filas porque el status ya cambió, y falla explícitamente
    // en vez de aplicar la transición dos veces.
    const resultado = await tx.package.updateMany({
      where: { id: pkg.id, status: estadoAnterior },
      data: { status: nuevoEstado, ...camposExtra },
    });
    if (resultado.count === 0) {
      throw new TransicionInvalidaError(
        'Este paquete ya fue actualizado por otra operación en curso. Vuelve a buscarlo para ver su estado actual.'
      );
    }
    await tx.packageHistory.create({
      data: { packageId: pkg.id, estado: nuevoEstado, fecha: now, userId, nota: nota ?? null },
    });
    return tx.package.findUniqueOrThrow({ where: { id: pkg.id } });
  }, TRANSACTION_OPTS);

  // Auditoria (Modulo 7): un solo lugar para las 5 transiciones de estado
  // (Entrega, Deposito), en vez de repetir la llamada en cada endpoint.
  await registrarAuditoria({
    userId,
    accion: `PAQUETE_${nuevoEstado}`,
    modulo: 'paquetes',
    valorAnterior: { code: pkg.code, status: estadoAnterior },
    valorNuevo: { code: pkg.code, status: nuevoEstado },
  });

  return actualizado;
}

export type TipoPago = 'ANTICIPO' | 'COBRO_ENTREGA' | 'AJUSTE';

/**
 * Nucleo compartido de "aplicar un movimiento de dinero", usado DENTRO de
 * una transaccion ya abierta por el llamador (registrarPago() abre la
 * suya propia; entregaExcepcional() la reutiliza dentro de la MISMA
 * transaccion que crea el paquete — ver comentario ahi de por que esto
 * tiene que ser atomico). Nunca se exporta: solo existe para no duplicar
 * esta logica en los dos lugares que la necesitan.
 */
async function aplicarPagoEnTx(
  tx: Prisma.TransactionClient,
  packageId: string,
  montoAnterior: number,
  montoDelta: number,
  costoActual: number,
  tipo: TipoPago,
  userId: string | null,
  motivo?: string,
  fecha?: Date
): Promise<Package> {
  const montoNuevo = Math.round((montoAnterior + montoDelta) * 100) / 100;
  const estadoPago: PaymentStatus = montoNuevo <= 0 ? 'PENDIENTE' : montoNuevo >= costoActual ? 'PAGADO' : 'PARCIAL';
  const actualizado = await tx.package.update({ where: { id: packageId }, data: { montoPagado: montoNuevo, estadoPago } });
  await tx.pago.create({
    data: { packageId, tipo, monto: montoDelta, montoAnterior, montoNuevo, motivo: motivo || null, userId, ...(fecha ? { createdAt: fecha } : {}) },
  });
  return actualizado;
}

/**
 * Registra un movimiento de dinero sobre un paquete (anticipo en
 * Recepcion, cobro en Entrega, o ajuste posterior desde Finanzas) sin
 * modificar nunca silenciosamente el acumulado anterior: cada llamada
 * agrega una fila nueva a Pago con el monto anterior y el nuevo, y
 * recalcula "estadoPago" comparando lo pagado contra el costo acumulado
 * en este momento (que sigue creciendo con los dias, pagos anticipados
 * no lo congelan — ver especificacion, seccion Pagos anticipados).
 *
 * "fecha" (opcional, default "ahora"): SOLO existe para que Importacion
 * pueda registrar un cobro con la fecha REAL de una entrega historica (ver
 * crearPaquetesFaltantes/confirmarImportacion en importacion.ts) — sin
 * esto, un paquete importado con entregaAt del 20/08 terminaba con su
 * Pago fechado "hoy", y Finanzas lo contaba como cobrado hoy en vez de en
 * su fecha real (ver especificacion, "Importacion con fechas"). El resto
 * de los llamadores (Recepcion, Entrega, correcciones) nunca la pasan:
 * para ellos el movimiento ocurre genuinamente ahora.
 *
 * Vuelve a leer el paquete DENTRO de la transaccion interactiva (mismo
 * criterio que corregirCobroAbsoluto(), ver comentario ahi) en vez de
 * confiar en el "pkg" que el llamador leyo hace un rato: con SQLite en
 * connection_limit=1 eso serializa dos registrarPago() casi simultaneos
 * sobre el mismo paquete, asi que el segundo siempre calcula su delta
 * sobre el montoPagado YA actualizado por el primero. Sin esto, dos
 * cobros de Bs2 casi simultaneos podian escribir cada uno "montoNuevo =
 * montoAnterior(obsoleto) + 2" y el segundo pisaba el resultado del
 * primero — las dos filas de Pago quedaban igual (el ledger nunca se
 * pierde), pero Package.montoPagado terminaba en Bs2 en vez de Bs4.
 */
export async function registrarPago(pkg: Package, tipo: TipoPago, montoDelta: number, userId: string | null, motivo?: string, fecha?: Date): Promise<Package> {
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);

  const actualizado = await prisma.$transaction(async (tx) => {
    const actual = await tx.package.findUniqueOrThrow({ where: { id: pkg.id } });

    const costoActual = calcularCosto(
      actual.ingresoAt,
      fechaReferencia(actual),
      { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
      feriados,
      actual.tarifaBaseOverride,
      actual.diasIncluidosOverride
    ).total;

    return aplicarPagoEnTx(tx, actual.id, actual.montoPagado, montoDelta, costoActual, tipo, userId, motivo, fecha);
  }, TRANSACTION_OPTS);

  await registrarAuditoria({
    userId: userId ?? undefined,
    accion: `PAGO_${tipo}`,
    modulo: 'finanzas',
    valorAnterior: { code: pkg.code, montoPagado: pkg.montoPagado },
    valorNuevo: { code: pkg.code, montoPagado: actualizado.montoPagado, motivo: motivo || undefined },
  });

  return actualizado;
}

/**
 * Corrige el monto pagado de un paquete a un valor ABSOLUTO (Finanzas >
 * Corregir cobro), a diferencia de registrarPago() que aplica un delta ya
 * decidido por el llamador sobre un "pkg" leido hace un rato. Esta funcion
 * vuelve a leer el paquete DENTRO de la misma transaccion interactiva
 * antes de calcular el delta: con SQLite en connection_limit=1 (ver
 * .env.example), esa transaccion ocupa la unica conexion durante toda su
 * duracion, asi que una segunda correccion casi simultanea sobre el mismo
 * paquete no puede empezar la suya hasta que esta termine, y para entonces
 * lee el monto YA corregido. Sin esto, dos PATCH concurrentes con el mismo
 * "montoCorregido" leian el mismo montoPagado anterior y las dos escribian
 * su propia fila de AJUSTE — duplicando el ajuste en el libro de Pago
 * aunque el campo "montoPagado" terminara reflejando un solo incremento
 * (confirmado con una prueba real de dos correcciones concurrentes antes
 * de este fix).
 */
export async function corregirCobroAbsoluto(code: string, montoCorregido: number, userId: string, motivo?: string): Promise<Package> {
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  const montoRedondeado = Math.round(montoCorregido * 100) / 100;

  const actualizado = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({ where: { codigoNormalizado: normalizarCodigo(code) } });
    if (!pkg) throw new PaqueteNoEncontradoError(code);

    const montoAnterior = pkg.montoPagado;
    if (Math.round(montoAnterior * 100) === Math.round(montoRedondeado * 100)) {
      return pkg; // Sin cambio real que registrar (evita una fila de AJUSTE de Bs0).
    }

    const montoDelta = Math.round((montoRedondeado - montoAnterior) * 100) / 100;
    const costoActual = calcularCosto(
      pkg.ingresoAt,
      fechaReferencia(pkg),
      { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
      feriados,
      pkg.tarifaBaseOverride,
      pkg.diasIncluidosOverride
    ).total;
    const estadoPago: PaymentStatus = montoRedondeado <= 0 ? 'PENDIENTE' : montoRedondeado >= costoActual ? 'PAGADO' : 'PARCIAL';

    const nuevo = await tx.package.update({ where: { id: pkg.id }, data: { montoPagado: montoRedondeado, estadoPago } });
    await tx.pago.create({
      data: { packageId: pkg.id, tipo: 'AJUSTE', monto: montoDelta, montoAnterior, montoNuevo: montoRedondeado, motivo: motivo || null, userId },
    });
    return nuevo;
  }, TRANSACTION_OPTS);

  await registrarAuditoria({
    userId,
    accion: 'PAGO_AJUSTE',
    modulo: 'finanzas',
    valorAnterior: { code },
    valorNuevo: { code, montoPagado: actualizado.montoPagado, motivo: motivo || undefined },
  });

  return actualizado;
}

export async function entregarPaquete(
  code: string,
  userId: string,
  opts?: {
    observaciones?: string;
    montoCobrado?: number;
    motivoCobro?: string;
    destinatario?: string;
    destinatarioTelefono?: string;
    destinatarioObservaciones?: string;
  }
): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status !== 'EN_PAQUETERIA') {
    throw new TransicionInvalidaError('Solo se pueden entregar paquetes en estado "En Paquetería".');
  }
  const now = new Date();
  const entregado = await transicionar(pkg, 'ENTREGADO', userId, {
    entregaAt: now,
    ...(opts?.observaciones !== undefined ? { observaciones: opts.observaciones } : {}),
    ...(opts?.destinatario !== undefined ? { destinatario: opts.destinatario || null } : {}),
    ...(opts?.destinatarioTelefono !== undefined ? { destinatarioTelefono: opts.destinatarioTelefono || null } : {}),
    ...(opts?.destinatarioObservaciones !== undefined ? { destinatarioObservaciones: opts.destinatarioObservaciones || null } : {}),
  });

  if (opts?.montoCobrado !== undefined && opts.montoCobrado !== 0) {
    return registrarPago(entregado, 'COBRO_ENTREGA', opts.montoCobrado, userId, opts.motivoCobro);
  }
  return entregado;
}

export async function denegarPaquete(code: string, userId: string): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status === 'ENTREGADO' || pkg.status === 'DENEGADO') {
    throw new TransicionInvalidaError('El paquete ya fue entregado o denegado.');
  }
  return transicionar(pkg, 'DENEGADO', userId, { denegadoAt: new Date() });
}

export async function enviarADeposito(code: string, userId: string): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status !== 'EN_PAQUETERIA') {
    throw new TransicionInvalidaError('Solo paquetes en estado "En Paquetería" pueden enviarse a depósito.');
  }
  return transicionar(pkg, 'EN_DEPOSITO', userId, { depositoAt: new Date() });
}

export async function solicitarBajarDeposito(code: string, userId: string): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status !== 'EN_DEPOSITO') {
    throw new TransicionInvalidaError('Solo paquetes en estado "En Depósito" pueden solicitarse para bajar.');
  }
  return transicionar(pkg, 'PENDIENTE_BAJAR', userId, { pendienteAt: new Date() });
}

/** Usado por el modulo de Deposito: confirma que un paquete pendiente ya fue bajado fisicamente. */
export async function bajarDeDeposito(code: string, userId: string): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status !== 'PENDIENTE_BAJAR') {
    throw new TransicionInvalidaError('Solo paquetes en estado "Pendiente de bajar" pueden volver a "En Paquetería".');
  }
  return transicionar(pkg, 'EN_PAQUETERIA', userId, { pendienteAt: null });
}

/**
 * Corrige un paquete marcado ENTREGADO por error, devolviéndolo al flujo
 * normal (EN_PAQUETERIA) — caso real: el operador escaneó/confirmó una
 * entrega equivocada. NUNCA crea un registro nuevo ni cambia "code" o
 * "ingresoAt" (la fecha original de ingreso es inmutable por esta vía,
 * igual que el resto del sistema): solo cambia "status" y limpia
 * "entregaAt" (mismo criterio que bajarDeDeposito() limpia "pendienteAt"
 * al volver a EN_PAQUETERIA — el timestamp de un estado que se abandona
 * no debe seguir colgando en el paquete activo). La entrega anterior NO
 * se pierde: queda para siempre en PackageHistory (la fila ENTREGADO ya
 * escrita en su momento nunca se borra ni se modifica), y esta misma
 * transición agrega su propia fila EN_PAQUETERIA con una nota explicando
 * el motivo, para que la trazabilidad completa (ingreso → entrega →
 * reingreso → nueva entrega, si vuelve a pasar) quede reconstruible.
 * Pagos/montoPagado tampoco se tocan (ver corregir/route.ts para ajustar
 * un cobro mal hecho) — reingresar es una corrección de ESTADO, no de dinero.
 */
export async function reingresarPaquete(code: string, userId: string, motivo?: string): Promise<Package> {
  const pkg = await buscarOFallar(code);
  if (pkg.status !== 'ENTREGADO') {
    throw new TransicionInvalidaError('Solo se pueden volver a ingresar paquetes que estén en estado "Entregado".');
  }
  return transicionar(
    pkg,
    'EN_PAQUETERIA',
    userId,
    { entregaAt: null },
    motivo?.trim() ? `Reingreso: ${motivo.trim()}` : 'Reingreso: marcado como entregado por error'
  );
}

export class SerieNoConfiguradaError extends Error {
  constructor(inicial: string) {
    super(`La serie "${inicial}" no está configurada o está inactiva. Pide a un administrador que la registre en Configuración.`);
    this.name = 'SerieNoConfiguradaError';
  }
}

export interface EntregaExcepcionalOpts {
  // Obligatorio: por que este codigo se entrega sin haber pasado por
  // Recepcion (ver comentario de entregaExcepcional() mas abajo).
  motivoExcepcional: MotivoEntregaExcepcional;
  // Obligatorio solo cuando motivoExcepcional==='OTRO' (validado en la
  // ruta) — el detalle libre que las 3 opciones fijas no cubren.
  motivoDetalle?: string;
  destinatario?: string;
  destinatarioTelefono?: string;
  destinatarioObservaciones?: string;
  observaciones?: string;
  // Entero positivo (validado en la ruta): si se omite, se cobra
  // automaticamente la tarifa vigente. Bs0 NUNCA se acepta por aqui — ver
  // "exonerado" para la unica via legitima de entregar sin cobrar.
  montoCobrado?: number;
  motivoCobro?: string;
  // Exoneracion administrativa explicita (Bs0), excluyente con
  // montoCobrado — validado en la ruta que nunca lleguen los dos juntos,
  // y que motivoExoneracion venga obligatorio cuando exonerado=true.
  exonerado?: boolean;
  motivoExoneracion?: string;
}

/**
 * "Entrega excepcional": crea el paquete + registra la recepcion omitida
 * + lo entrega + registra su cobro (o exoneracion), TODO en una unica
 * transaccion atomica, para un codigo que NUNCA paso por Recepcion. Solo
 * debe llamarse cuando ya se confirmo que el codigo no existe (si existe,
 * corresponde el flujo normal de entregarPaquete() — esta funcion
 * rechaza explicitamente ese caso, nunca pisa un paquete real).
 *
 * Antes, la creacion del paquete y el registro del cobro eran DOS
 * transacciones separadas (esta funcion hacia su propio $transaction, y
 * despues llamaba a registrarPago(), que abria OTRA): si la segunda
 * fallaba por cualquier motivo, el paquete quedaba creado igual —
 * ENTREGADO + Bs0 + PENDIENTE + sin ningun Pago, indistinguible de un
 * cobro simplemente olvidado. Ahora ambas cosas ocurren dentro del MISMO
 * prisma.$transaction: si el registro del pago falla, tampoco queda
 * creado el Package ni su PackageHistory (rollback completo). Nunca se
 * llama a registrarPago() desde aqui adentro (abriria una segunda
 * transaccion anidada) — se usa aplicarPagoEnTx() directamente sobre el
 * mismo "tx".
 *
 * ingresoAt y entregaAt quedan iguales a "ahora" (no hay una fecha de
 * recepcion real que registrar — el paquete nunca paso por Recepcion).
 * Reutiliza el campo YA EXISTENTE "origenEntrega" (hasta ahora solo valia
 * 'IMPORTACION' o null) con el valor nuevo 'EXCEPCIONAL', asi que esto no
 * requiere ningun cambio de schema. Dos filas de PackageHistory dejan la
 * trazabilidad explicita: "Recepción omitida" y luego "Entrega
 * excepcional" — nunca se ve igual que una recepcion+entrega normal en el
 * historial. opts.motivoExcepcional es OBLIGATORIO (validado ya en la
 * ruta) y queda grabado tal cual en la nota del historial — nunca se
 * inventa un motivo generico cuando el operador no dio uno real.
 *
 * SIEMPRE se crea una fila de Pago para el cobro/exoneracion (incluso
 * cuando el monto aplicado es Bs0 por exoneracion, o por una tarifa
 * configurada en Bs0): desde este fix, un ENTREGADO sin absolutamente
 * ningun Pago asociado solo puede significar "nunca se registro nada" —
 * nunca una decision deliberada, que ahora siempre queda como un
 * movimiento real y auditable en el libro de Pago.
 */
export async function entregaExcepcional(code: string, userId: string, branchId: string, opts: EntregaExcepcionalOpts): Promise<Package> {
  const codigoNormalizado = normalizarCodigo(code);
  const existente = await prisma.package.findUnique({ where: { codigoNormalizado } });
  if (existente) {
    throw new TransicionInvalidaError('Este código ya existe en el sistema; usa la entrega normal en vez de la excepcional.');
  }

  const inicial = code.match(/^[A-Z]+/)?.[0];
  if (!inicial) {
    throw new TransicionInvalidaError('El código no tiene un formato reconocible (debe iniciar con letras, ej: M26L-001).');
  }

  const serie = await prisma.packageSeries.findUnique({ where: { inicial } });
  if (!serie || !serie.activo) {
    throw new SerieNoConfiguradaError(inicial);
  }

  const now = new Date();
  const motivoTexto =
    opts.motivoExcepcional === 'OTRO' && opts.motivoDetalle?.trim()
      ? `Otro: ${opts.motivoDetalle.trim()}`
      : MOTIVO_ENTREGA_EXCEPCIONAL_LABEL[opts.motivoExcepcional];

  // Tarifa vigente AHORA MISMO para este paquete: con ingresoAt=entregaAt
  // (0 dias transcurridos) es siempre la tarifa base o su override de
  // serie, nunca dias extra — se puede calcular antes de abrir la
  // transaccion porque solo depende de configuracion/feriados/serie, ya
  // leidos arriba.
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  const costoActual = calcularCosto(
    now,
    now,
    { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
    feriados,
    serie.tarifaBaseOverride,
    null
  ).total;

  // Una entrega excepcional SIGUE SIENDO UNA ENTREGA: siempre corresponde
  // cobrar, salvo exoneracion administrativa explicita. Bs0 nunca es un
  // "monto normal" (ver especificacion) — solo llega aqui como
  // opts.exonerado=true, ya validado en la ruta (permiso + motivo
  // obligatorio). Sin monto ni exoneracion, se autocobra la tarifa vigente.
  const montoAplicado = opts.exonerado ? 0 : (opts.montoCobrado ?? costoActual);
  const motivoMovimiento = opts.exonerado ? `Exoneración de cobro (entrega excepcional): ${opts.motivoExoneracion}` : opts.motivoCobro;

  const pkg = await prisma.$transaction(async (tx) => {
    const nuevo = await tx.package.create({
      data: {
        code,
        codigoNormalizado,
        inicial,
        branchId,
        status: 'ENTREGADO',
        ingresoAt: now,
        entregaAt: now,
        tarifaBaseOverride: serie.tarifaBaseOverride,
        registradoPorId: userId,
        destinatario: opts.destinatario || null,
        destinatarioTelefono: opts.destinatarioTelefono || null,
        destinatarioObservaciones: opts.destinatarioObservaciones || null,
        observaciones: opts.observaciones || '',
        origenEntrega: 'EXCEPCIONAL',
      },
    });
    await tx.packageHistory.create({
      data: { packageId: nuevo.id, estado: 'EN_PAQUETERIA', fecha: now, userId, nota: `Recepción omitida (entrega excepcional): ${motivoTexto}` },
    });
    await tx.packageHistory.create({
      data: { packageId: nuevo.id, estado: 'ENTREGADO', fecha: now, userId, nota: `Entrega excepcional: paquete no figuraba como recibido — ${motivoTexto}` },
    });
    return aplicarPagoEnTx(tx, nuevo.id, 0, montoAplicado, costoActual, 'COBRO_ENTREGA', userId, motivoMovimiento);
  }, TRANSACTION_OPTS);

  await registrarAuditoria({
    userId,
    accion: 'ENTREGA_EXCEPCIONAL',
    modulo: 'entrega',
    valorNuevo: { code: pkg.code, status: pkg.status, motivoExcepcional: opts.motivoExcepcional, motivoTexto, montoCobrado: montoAplicado, exonerado: !!opts.exonerado },
  });
  if (opts.exonerado) {
    await registrarAuditoria({
      userId,
      accion: 'EXONERACION_COBRO',
      modulo: 'entrega',
      valorNuevo: { code: pkg.code, motivoExoneracion: opts.motivoExoneracion, tarifaVigente: costoActual },
    });
  }

  return pkg;
}
