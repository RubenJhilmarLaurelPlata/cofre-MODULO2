// src/lib/interop-envios.ts
// Fase 4.3/4.4: capa de DOMINIO que conecta el protocolo genérico de
// src/lib/interop/ (que no sabe nada de Prisma ni de Envio/SucursalDestino/
// Package) con los datos reales de esta instalación. Vive fuera de la
// carpeta interop/ a propósito — esa carpeta se mantiene deliberadamente
// agnóstica de base de datos (ver su README.md).
//
// Fase 4.3 (solo lectura): resolverApiKeyEntrante(), getEnvioParaInterop().
// Fase 4.4 (primera escritura real inter-sucursal): recibirEnvioParaInterop()
// (lado ORIGEN — ejecuta recibirEnvio() real, nunca crea Package) y
// materializarRecepcionRemota() (lado DESTINO — crea Package/PackageHistory/
// EnvioRecepcionRemota PROPIOS; nunca toca la base de otra instalación).
import { Prisma } from '@prisma/client';
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { getCompanyConfig } from '@/lib/config';
import { compararTimingSafe } from '@/lib/interop/firma';
import { recibirEnvio, EnvioNoRecibibleError } from '@/lib/envios';
import { normalizarCodigo } from '@/lib/codigo';
import { SerieNoConfiguradaError, CodigoInvalidoError } from '@/lib/paquete-registro';
import { emitirEventoPaquete } from '@/lib/tracking/eventos';
import type { EnvioInteropDTO, EnvioInteropPaqueteDTO } from '@/lib/interop/dto';

/**
 * Secreto que la sucursal `sucursalCodigo` debe usar para autenticarse
 * ANTE esta instalación (SucursalDestino.apiKeyEntrante, Fase 4.1). Null
 * si esa sucursal no está en el catálogo, está inactiva, o simplemente no
 * tiene comunicación configurada todavía — en cualquiera de esos casos,
 * verificarFirmaInterop() (src/lib/interop/verificar.ts) lo trata como
 * "sucursal desconocida" (401), nunca como un error interno.
 */
export async function resolverApiKeyEntrante(sucursalCodigo: string): Promise<string | null> {
  const destino = await prisma.sucursalDestino.findFirst({
    where: { codigo: sucursalCodigo, activa: true },
    select: { apiKeyEntrante: true },
  });
  return destino?.apiKeyEntrante ?? null;
}

export type MotivoRechazoEnvioInterop = 'NO_ENCONTRADO' | 'NO_ES_DESTINO';
export type ResultadoEnvioInterop = { ok: true; dto: EnvioInteropDTO } | { ok: false; motivo: MotivoRechazoEnvioInterop };

// Solo estados que alguna vez tuvieron un QR real emitido — un BORRADOR
// todavía se está armando localmente (puede perder/ganar paquetes en
// cualquier momento) y un CANCELADO nunca llegó a salir: ninguno de los
// dos tiene sentido exponer a otra instalación (mismo criterio ya usado
// por getInfoEnvioDePaquete() en src/lib/envios.ts).
const ESTADOS_CONSULTABLES = ['CERRADO', 'RECIBIDO'] as const;

/**
 * Resuelve la consulta de solo lectura de un Envío para otra instalación
 * ya autenticada. `sucursalSolicitanteCodigo` es el código YA VERIFICADO
 * por HMAC (ver verificarFirmaInterop) de quien pregunta — nunca un valor
 * que el cliente pueda declarar aparte sin firmar.
 *
 * Devuelve NO_ENCONTRADO tanto si el código no existe como si existe pero
 * en un estado no consultable (BORRADOR/CANCELADO) — deliberadamente el
 * mismo motivo en ambos casos, para no revelarle a quien consulta que un
 * código "casi existe" en un estado interno.
 *
 * Devuelve NO_ES_DESTINO si el envío existe y es consultable, pero fue
 * despachado hacia una sucursal distinta de quien pregunta — esto es lo
 * que impide que una sucursal vea arbitrariamente envíos ajenos (punto de
 * seguridad explícito de esta fase).
 */
export async function getEnvioParaInterop(codigo: string, sucursalSolicitanteCodigo: string): Promise<ResultadoEnvioInterop> {
  const [envio, company] = await Promise.all([
    prisma.envio.findUnique({
      where: { codigo: codigo.trim().toUpperCase() },
      include: {
        destino: { select: { codigo: true, nombre: true } },
        items: {
          select: { estadoPago: true, montoPagado: true, package: { select: { code: true, destinatario: true, destinatarioTelefono: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    getCompanyConfig(),
  ]);

  if (!envio || !(ESTADOS_CONSULTABLES as readonly string[]).includes(envio.estado)) {
    return { ok: false, motivo: 'NO_ENCONTRADO' };
  }
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) {
    return { ok: false, motivo: 'NO_ES_DESTINO' };
  }

  const paquetes: EnvioInteropPaqueteDTO[] = envio.items.map((it) => ({
    codigo: it.package.code,
    destinatario: it.package.destinatario,
    destinatarioTelefono: it.package.destinatarioTelefono,
    estadoPago: it.estadoPago as EnvioInteropPaqueteDTO['estadoPago'],
    montoPagado: it.montoPagado,
  }));

  const dto: EnvioInteropDTO = {
    transferenciaId: envio.transferenciaId,
    codigo: envio.codigo,
    estado: envio.estado,
    origen: { codigo: company.sucursalCodigo, nombre: company.sucursalNombre },
    destino: { codigo: envio.destino.codigo, nombre: envio.destino.nombre },
    cantidadPaquetes: envio.items.length,
    paquetes,
    cerradoAt: envio.cerradoAt ? envio.cerradoAt.toISOString() : null,
  };

  return { ok: true, dto };
}

// ---------------------------------------------------------------------
// Fase 4.4 — recepción remota (lado ORIGEN)
// ---------------------------------------------------------------------

export type MotivoRechazoRecepcionInterop = 'NO_ENCONTRADO' | 'NO_ES_DESTINO' | 'QR_INVALIDO' | 'ESTADO_INVALIDO' | 'YA_RECIBIDO_LOCALMENTE';
export type ResultadoRecepcionInterop = { ok: true; dto: EnvioInteropDTO } | { ok: false; motivo: MotivoRechazoRecepcionInterop };

/**
 * Ejecuta (en ESTA instalación, la de ORIGEN) la recepción de un envío
 * solicitada por otra instalación — el lado servidor de
 * POST /api/interop/envios/[codigo]/recibir. Reutiliza recibirEnvio()
 * (src/lib/envios.ts) tal cual para la transición de estado real: la
 * única adaptación que esa función necesitó fue aceptar `userId`
 * opcional y un `opts.viaInterop` opcional (ver su comentario) — su
 * lógica de transición CERRADO -> RECIBIDO, y la protección contra
 * doble-recepción/condición de carrera, no cambiaron en absoluto.
 *
 * Esta función JAMÁS crea ni toca Package — eso es responsabilidad
 * exclusiva del DESTINO (ver materializarRecepcionRemota() más abajo),
 * nunca del origen.
 *
 * Orden de validación (deliberado, ver informe de Fase 4.4):
 *   1. ¿Existe el código?                          -> NO_ENCONTRADO
 *   2. ¿El solicitante es realmente el destino?     -> NO_ES_DESTINO
 *   3. ¿El estado admite recepción (CERRADO o ya
 *      RECIBIDO)? BORRADOR/CANCELADO nunca la
 *      admiten (nunca tuvieron un qrToken real)     -> ESTADO_INVALIDO
 *   4. ¿El qrToken presentado coincide (timing-safe)
 *      con el guardado? SIEMPRE se revisa, incluso
 *      si ya estaba RECIBIDO — nunca se salta la
 *      prueba de posesión física del QR solo porque
 *      "total, ya da igual"                          -> QR_INVALIDO
 *   5. Si estaba CERRADO: se ejecuta recibirEnvio()
 *      real con `{ viaInterop: true }`. Si en el
 *      instante exacto de aplicarla otra request ganó
 *      la carrera (recibirEnvio() lanza
 *      EnvioNoRecibibleError porque el updateMany ya
 *      no encontró la fila en CERRADO), NO se trata
 *      como error — se re-lee el estado real y se
 *      decide en el paso 6, igual que si ya hubiera
 *      estado RECIBIDO desde el principio.
 *   6. Se relee el envío (fresco, nunca un valor
 *      supuesto) y SIEMPRE se decide por su
 *      `recibidoViaInterop` real, sin importar si
 *      «acabamos» de recibirlo en el paso 5 o ya
 *      estaba RECIBIDO desde antes de esta llamada:
 *        - `recibidoViaInterop=true`  -> IDEMPOTENTE,
 *          se devuelve el mismo DTO de éxito (cubre un
 *          reintento genuino del destino Y el caso de
 *          haber perdido la carrera de concurrencia
 *          contra OTRA request de interop idéntica).
 *        - `recibidoViaInterop=false` -> este envío ya
 *          fue recibido LOCALMENTE (por un operador de
 *          ESTA instalación, antes de esta llamada, o
 *          justo ahora si ganó la carrera del paso 5)
 *          -> `YA_RECIBIDO_LOCALMENTE`. Decisión
 *          explícita (consultada antes de
 *          implementarse): NUNCA se reconcilia en
 *          silencio "subiendo" recibidoViaInterop a
 *          true — una recepción local ya se considera
 *          definitiva/terminal, y una coincidencia con
 *          una solicitud remota real para el MISMO
 *          envío es una situación anómala que merece
 *          investigarse, no resolverse automáticamente.
 *
 * NO_ES_DESTINO y QR_INVALIDO se traducen al MISMO código HTTP (403) con
 * el MISMO mensaje genérico en la ruta — nunca se revela desde afuera
 * cuál de los dos fue, ni si el código existe con un token distinto (ver
 * README.md).
 */
export async function recibirEnvioParaInterop(codigo: string, sucursalSolicitanteCodigo: string, qrToken: string): Promise<ResultadoRecepcionInterop> {
  const envio = await prisma.envio.findUnique({
    where: { codigo: codigo.trim().toUpperCase() },
    select: { id: true, estado: true, qrToken: true, destino: { select: { codigo: true } } },
  });
  if (!envio) return { ok: false, motivo: 'NO_ENCONTRADO' };
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) return { ok: false, motivo: 'NO_ES_DESTINO' };
  if (envio.estado !== 'CERRADO' && envio.estado !== 'RECIBIDO') return { ok: false, motivo: 'ESTADO_INVALIDO' };

  // Nunca "==="/"!==" para un secreto — timing-safe siempre, igual que la
  // firma HMAC del propio request (ver src/lib/interop/firma.ts, misma
  // función reutilizada aquí: un qrToken es, en los hechos, un segundo
  // factor de autorización, y merece la misma disciplina).
  if (!envio.qrToken || !compararTimingSafe(envio.qrToken, qrToken)) {
    return { ok: false, motivo: 'QR_INVALIDO' };
  }

  if (envio.estado === 'CERRADO') {
    try {
      await recibirEnvio(envio.id, undefined, { viaInterop: true });
    } catch (err) {
      // Perdió la carrera contra otra request concurrente (de interop O
      // local) — nunca se trata como error aquí: el paso siguiente relee
      // el estado real y decide correctamente en cualquiera de los dos casos.
      if (!(err instanceof EnvioNoRecibibleError)) throw err;
    }
  }

  // Se re-lee SIEMPRE (nunca un valor supuesto) — ver paso 6 del comentario.
  const actual = await prisma.envio.findUnique({ where: { id: envio.id }, select: { estado: true, recibidoViaInterop: true } });
  if (!actual || actual.estado !== 'RECIBIDO') {
    // No debería ocurrir nunca en la práctica (estado solo avanza hacia
    // adelante) — defensivo, nunca se asume.
    return { ok: false, motivo: 'ESTADO_INVALIDO' };
  }
  if (!actual.recibidoViaInterop) {
    return { ok: false, motivo: 'YA_RECIBIDO_LOCALMENTE' };
  }

  const resultado = await getEnvioParaInterop(codigo, sucursalSolicitanteCodigo);
  return resultado.ok ? resultado : { ok: false, motivo: 'ESTADO_INVALIDO' };
}

// ---------------------------------------------------------------------
// Fase 4.4 — materialización de paquetes (lado DESTINO)
// ---------------------------------------------------------------------

export interface PaqueteAMaterializar {
  codigo: string;
  destinatario: string | null;
  destinatarioTelefono: string | null;
  estadoPago: 'PENDIENTE' | 'PAGADO';
  montoPagado: number;
}

export interface MaterializarRecepcionRemotaInput {
  /** Envio.transferenciaId de la instalación de ORIGEN — clave real de idempotencia (ver EnvioRecepcionRemota, Fase 4.1). */
  transferenciaId: string;
  /** Company.sucursalCodigo de la instalación de ORIGEN (viaja como EnvioInteropDTO.origen.codigo). */
  origenCodigo: string;
  /** Envio.codigo visible de origen — solo para trazabilidad/auditoría. */
  envioCodigoOrigen: string;
  paquetes: PaqueteAMaterializar[];
}

export interface ResultadoMaterializacion {
  /** true si esta transferencia YA había sido materializada antes (idempotente — ver punto 4/9/10 del pedido) y por lo tanto NO se volvió a crear/tocar ningún Package esta vez. */
  yaMaterializada: boolean;
  cantidadPaquetes: number;
}

/**
 * Materializa, EN ESTA INSTALACIÓN (el DESTINO), los paquetes de una
 * transferencia ya confirmada por el origen (ver recibirEnvioParaInterop()
 * más arriba, que corre en el servidor de ORIGEN — esta función corre en
 * el servidor de DESTINO, después de recibir su respuesta exitosa vía
 * recibirEnvioRemoto(), src/lib/interop/cliente.ts).
 *
 * TRANSACCIONAL de punta a punta (punto 8 del pedido: "si el lote tiene
 * 87 paquetes, no queremos 87 -> 40 creados -> error -> inconsistente"):
 * TODO ocurre dentro de un único prisma.$transaction — si cualquier
 * paquete falla (ej. su inicial no tiene una PackageSeries configurada
 * en ESTA instalación), se hace ROLLBACK completo, sin dejar ningún
 * Package a medio crear. Un reintento posterior (una vez corregida la
 * causa) vuelve a intentar desde cero — nunca queda un estado parcial
 * que "arrastrar".
 *
 * IDEMPOTENCIA (punto 4/9/10 del pedido) en DOS capas, deliberadamente
 * redundantes:
 *
 *   1. EnvioRecepcionRemota.transferenciaId (única) se intenta CREAR
 *      PRIMERO, antes de tocar ningún Package. Si ya existe una fila con
 *      ese transferenciaId (choque P2002), esta MISMA transacción se
 *      corta ahí — nunca se vuelve a materializar nada — y se devuelve
 *      `yaMaterializada: true`. Esto es lo que resuelve limpiamente tanto
 *      "la respuesta de origen se perdió y el destino reintentó todo el
 *      flujo" (punto 10) como "dos requests simultáneas para la misma
 *      transferencia" (punto 9): bajo connection_limit=1 (ver
 *      src/lib/prisma.ts) las transacciones ya se serializan solas —
 *      SIEMPRE gana una sola, la otra encuentra la fila ya creada y se
 *      retira sin tocar nada más.
 *   2. Aun si esa primera capa fallara, Package tiene su propio
 *      @@unique([origenSucursalCodigo, origenCodigoPaquete]) (Fase 4.1) —
 *      por eso se usa `upsert` (nunca `create` ciego, instrucción
 *      explícita del pedido): un choque ahí tampoco duplicaría nada.
 *      En operación normal esta segunda capa nunca debería activarse
 *      (la primera ya cortó el paso) — es defensa en profundidad, no el
 *      mecanismo principal.
 *
 * Status/branchId/PackageHistory (punto 7 del pedido, revisado contra
 * paquete-registro.ts/package-transitions.ts/package-detail.ts antes de
 * decidir): EN_PAQUETERIA — el MISMO status inicial que cualquier
 * paquete que ingresa por Recepción (registrarPaqueteBasico()); ningún
 * status nuevo. branchId: la sucursal activa configurada de ESTA
 * instalación (mismo criterio que ya usa
 * POST /api/envios/[id]/paquetes). Se crea una fila de PackageHistory
 * ("EN_PAQUETERIA", con nota explicando el origen) — mismo patrón que
 * registrarPaqueteBasico(), para que el historial del paquete no
 * empiece "de la nada". `code`/`codigoNormalizado` locales reutilizan
 * literalmente el código de origen (es el que está impreso en la
 * etiqueta física) — la inicial debe tener una PackageSeries activa
 * TAMBIÉN en esta instalación, exactamente la misma regla que ya aplica
 * a cualquier código nuevo por Recepción/Envíos (SerieNoConfiguradaError,
 * reutilizado tal cual, nunca un caso especial nuevo).
 */
export async function materializarRecepcionRemota(input: MaterializarRecepcionRemotaInput): Promise<ResultadoMaterializacion> {
  const company = await getCompanyConfig();
  const branchId = company.sucursalActualId ?? (await prisma.branch.findFirst({ where: { activo: true } }))?.id;
  if (!branchId) {
    throw new Error('No hay ninguna sucursal local activa configurada en esta instalación — no se puede materializar el paquete recibido.');
  }

  return prisma.$transaction(async (tx) => {
    try {
      await tx.envioRecepcionRemota.create({
        data: {
          transferenciaId: input.transferenciaId,
          origenCodigo: input.origenCodigo,
          envioCodigoOrigen: input.envioCodigoOrigen,
          cantidadPaquetes: input.paquetes.length,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { yaMaterializada: true, cantidadPaquetes: input.paquetes.length };
      }
      throw err;
    }

    for (const paquete of input.paquetes) {
      const inicialMatch = paquete.codigo.match(/^[A-Za-z]+/);
      const inicial = inicialMatch?.[0]?.toUpperCase();
      if (!inicial) throw new CodigoInvalidoError();

      const serie = await tx.packageSeries.findUnique({ where: { inicial } });
      if (!serie || !serie.activo) throw new SerieNoConfiguradaError(inicial);

      const codigoNormalizado = normalizarCodigo(paquete.codigo);
      const pkg = await tx.package.upsert({
        where: { origenSucursalCodigo_origenCodigoPaquete: { origenSucursalCodigo: input.origenCodigo, origenCodigoPaquete: paquete.codigo } },
        create: {
          code: paquete.codigo,
          codigoNormalizado,
          inicial,
          branchId,
          status: 'EN_PAQUETERIA',
          destinatario: paquete.destinatario,
          destinatarioTelefono: paquete.destinatarioTelefono,
          estadoPago: paquete.estadoPago,
          montoPagado: paquete.montoPagado,
          origenSucursalCodigo: input.origenCodigo,
          origenCodigoPaquete: paquete.codigo,
          origenTransferenciaId: input.transferenciaId,
        },
        // No debería alcanzarse nunca en operación normal (la capa 1 de
        // idempotencia ya cortó el paso antes de llegar aquí) — defensa
        // en profundidad que deliberadamente NO pisa ningún dato ya
        // materializado.
        update: {},
      });

      await tx.packageHistory.create({
        data: {
          packageId: pkg.id,
          estado: 'EN_PAQUETERIA',
          nota: `Recibido por transferencia entre sucursales (origen ${input.origenCodigo}, envío ${input.envioCodigoOrigen}).`,
        },
      });
    }

    return { yaMaterializada: false, cantidadPaquetes: input.paquetes.length };
  }, TRANSACTION_OPTS);
}

// ---------------------------------------------------------------------
// Fase 5.3-HARDENING — delegación de eventos de tracking (lado ORIGEN)
// ---------------------------------------------------------------------

export type MotivoRechazoDelegacionTracking = 'NO_ENCONTRADO' | 'NO_ES_DESTINO' | 'ESTADO_INVALIDO' | 'PAQUETE_NO_ENCONTRADO';
export type ResultadoDelegacionTracking = { ok: true; duplicado: boolean } | { ok: false; motivo: MotivoRechazoDelegacionTracking };

export interface EventoTrackingDelegadoInput {
  /** Envio.transferenciaId de ESTA instalación (el origen) — nunca se confía en un "origenCodigo" declarado sin verificar contra esto. */
  transferenciaId: string;
  /** Package.code tal como lo conoce ESTA instalación (= Package.origenCodigoPaquete en el destino que reporta). */
  origenCodigoPaquete: string;
  /** PackageHistory.id LOCAL del destino para la transición reportada — se reutiliza tal cual como identidad del evento (namespaced), nunca un id nuevo. */
  reporteId: string;
  tipoEvento: 'PAQUETE_TRANSICION';
  estadoInternoOrigen: string;
  fechaOrigen: Date;
}

/**
 * Ejecuta (en ESTA instalación, la de ORIGEN de la transferencia) la
 * emisión delegada de un evento de tracking que otra instalación (el
 * DESTINO real de esa transferencia, ya autenticado por HMAC — nunca un
 * campo declarado sin verificar) no puede firmar honestamente ella
 * misma — ver auditoría Fase 5.3-HARDENING, sección 3: Tracking exige que
 * el firmante HMAC coincida con "origenSucursalCodigo" del payload, así
 * que solo el origen real de un paquete puede reportar eventos sobre él.
 *
 * Reutiliza estructuras YA existentes, sin inventar ninguna identidad
 * nueva: Envio.transferenciaId (Fase 4.1) para ubicar la transferencia,
 * Envio.destino.codigo para confirmar que quien pide esto es realmente
 * el destino de ESE envío (mismo criterio que getEnvioParaInterop()/
 * recibirEnvioParaInterop() — nunca confiar en el campo declarado por sí
 * solo), y EnvioItem para confirmar que el paquete reportado
 * genuinamente viajó en ese lote. Solo después de esas tres validaciones
 * se llama a emitirEventoPaquete() (src/lib/tracking/eventos.ts) — la
 * MISMA función que usa cualquier transición local — pasándole
 * `sucursalActual` explícito (el destino real, no el origen) porque
 * aquí sí difiere de la identidad de origen resuelta.
 *
 * Orden de validación (mismo criterio que recibirEnvioParaInterop() —
 * nunca revelar desde afuera cuál punto exacto falló entre NO_ES_DESTINO
 * y PAQUETE_NO_ENCONTRADO, ver la ruta):
 *   1. ¿Existe una transferencia con ese transferenciaId?  -> NO_ENCONTRADO
 *   2. ¿El solicitante autenticado es realmente el destino
 *      de ESA transferencia?                                -> NO_ES_DESTINO
 *   3. ¿El envío ya está RECIBIDO? (BORRADOR/CERRADO/CANCELADO
 *      nunca deberían tener transiciones posteriores que
 *      reportar — el destino solo materializa Package después
 *      de una recepción real)                                -> ESTADO_INVALIDO
 *   4. ¿El paquete reportado realmente viajó en ese lote?     -> PAQUETE_NO_ENCONTRADO
 *
 * Idempotencia: `eventId` local = `INTEROP:${reporteId}` — si ya existe
 * un OutboxEvent con ese eventId (un reintento genuino del destino, ej.
 * porque la respuesta 201 se perdió), se responde `duplicado: true` sin
 * volver a encolar nada — mismo principio que TrackingEvent en
 * cofre-tracking (UNIQUE real, nunca una convención de aplicación).
 */
export async function registrarEventoTrackingDelegado(input: EventoTrackingDelegadoInput, sucursalSolicitanteCodigo: string): Promise<ResultadoDelegacionTracking> {
  const envio = await prisma.envio.findUnique({
    where: { transferenciaId: input.transferenciaId },
    include: { destino: { select: { codigo: true, nombre: true } }, items: { select: { package: { select: { code: true } } } } },
  });
  if (!envio) return { ok: false, motivo: 'NO_ENCONTRADO' };
  if (envio.destino.codigo !== sucursalSolicitanteCodigo) return { ok: false, motivo: 'NO_ES_DESTINO' };
  if (envio.estado !== 'RECIBIDO') return { ok: false, motivo: 'ESTADO_INVALIDO' };

  const item = envio.items.find((it) => it.package.code === input.origenCodigoPaquete);
  if (!item) return { ok: false, motivo: 'PAQUETE_NO_ENCONTRADO' };

  const eventId = `INTEROP:${input.reporteId}`;
  let duplicado = false;
  await prisma.$transaction(async (tx) => {
    const existente = await tx.outboxEvent.findUnique({ where: { eventId }, select: { id: true } });
    if (existente) {
      duplicado = true;
      return;
    }
    await emitirEventoPaquete(tx, {
      tipoEvento: 'PAQUETE_TRANSICION',
      eventId,
      pkg: { code: input.origenCodigoPaquete, origenSucursalCodigo: null, origenCodigoPaquete: null },
      estadoInternoOrigen: input.estadoInternoOrigen,
      fechaOrigen: input.fechaOrigen,
      sucursalActual: { codigo: sucursalSolicitanteCodigo, nombre: envio.destino.nombre },
    });
  }, TRANSACTION_OPTS);

  return { ok: true, duplicado };
}
