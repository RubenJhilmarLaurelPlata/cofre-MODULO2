// src/lib/paquete-registro.ts
// Alta MINIMA de un paquete nuevo (code -> Package EN_PAQUETERIA),
// compartida por Recepcion (src/app/api/recepcion/scan/route.ts, que
// ademas agrega cliente/foto/anticipo alrededor de esto) y por Envios
// (src/lib/envios.ts: agregarPaquete(), Fase 2.1 — "no obligar a pasar
// primero por Recepcion" antes de preparar un envio). Vive en su propio
// archivo, no en recepcion ni en envios, porque ninguno de los dos es
// "dueño" de esta logica — es el nucleo que ambos comparten.
//
// SIEMPRE se llama con un `tx` de una transaccion ya abierta por el
// llamador (nunca con el `prisma` de nivel superior aqui adentro): asi
// el llamador decide en que transaccion atomica entra el alta del
// paquete junto con su propio paso siguiente (ej. Envios reservandolo en
// el mismo `$transaction()`, sin ventana de carrera entre "crear" y
// "reservar" — mismo criterio ya aplicado al resto del modulo Envios).
import type { Prisma, Package } from '@prisma/client';
import { normalizarCodigo } from '@/lib/codigo';

export class CodigoInvalidoError extends Error {
  constructor() {
    super('El código no tiene un formato reconocible (debe iniciar con letras, ej: M26L-001).');
    this.name = 'CodigoInvalidoError';
  }
}

export class SerieNoConfiguradaError extends Error {
  constructor(inicial: string) {
    super(`La serie "${inicial}" no está configurada o está inactiva. Pide a un administrador que la registre en Configuración.`);
    this.name = 'SerieNoConfiguradaError';
  }
}

export interface CamposExtraRegistro {
  clienteId?: string | null;
  descripcion?: string | null;
  destinatario?: string | null;
  destinatarioTelefono?: string | null;
  destinatarioObservaciones?: string | null;
}

/**
 * Crea el paquete (+ su primera fila de PackageHistory, + marca usado el
 * GeneratedCode si corresponde). No valida duplicados por status: esa
 * regla es una conveniencia de UX (mensaje temprano y claro) que cada
 * llamador aplica a su manera antes de llegar aqui — la garantia real de
 * "código único" la da el índice único de Package.code/codigoNormalizado
 * en la base (un choque real termina en P2002, que el llamador ya
 * captura), igual que siempre funcionó en Recepción.
 */
export async function registrarPaqueteBasico(
  tx: Prisma.TransactionClient,
  code: string,
  branchId: string,
  userId: string,
  opciones: { tarifaBaseOverride?: number | null } = {},
  camposExtra?: CamposExtraRegistro
): Promise<Package> {
  const inicialMatch = code.match(/^[A-Z]+/);
  const inicial = inicialMatch?.[0];
  if (!inicial) throw new CodigoInvalidoError();

  const serie = await tx.packageSeries.findUnique({ where: { inicial } });
  if (!serie || !serie.activo) throw new SerieNoConfiguradaError(inicial);

  const codigoNormalizado = normalizarCodigo(code);
  const generatedCode = await tx.generatedCode.findUnique({ where: { code }, select: { tarifaOverride: true, diasIncluidosOverride: true } });

  const now = new Date();
  const nuevo = await tx.package.create({
    data: {
      code,
      codigoNormalizado,
      inicial,
      branchId,
      status: 'EN_PAQUETERIA',
      ingresoAt: now,
      tarifaBaseOverride: opciones.tarifaBaseOverride ?? generatedCode?.tarifaOverride ?? serie.tarifaBaseOverride,
      diasIncluidosOverride: generatedCode?.diasIncluidosOverride ?? null,
      registradoPorId: userId,
      ...camposExtra,
    },
  });

  await tx.packageHistory.create({ data: { packageId: nuevo.id, estado: 'EN_PAQUETERIA', fecha: now, userId } });
  await tx.generatedCode.updateMany({ where: { code, usado: false }, data: { usado: true } });

  return nuevo;
}
