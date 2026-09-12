// src/lib/tracking/identidad.ts
// Fase 5.3: resuelve la identidad "de tracking" de UN paquete — el par
// (origenSucursalCodigo, codigo) que el servicio independiente
// cofre-tracking usa como clave publica de un paquete (ver
// src/lib/interop/README.md y la auditoria de Fase 5.1). Cada
// instalacion SIEMPRE reporta usando esta identidad, nunca la propia sin
// mas, para que un paquete transferido (recibido via interop, Fase 4.4)
// siga identificandose ante el cliente con el mismo codigo que el origen
// le dio — ver Package.origenSucursalCodigo/origenCodigoPaquete en el
// schema.
//
// SIEMPRE se llama con un `tx` de una transaccion ya abierta (nunca con
// el `prisma` de nivel superior aqui adentro): Company.sucursalCodigo se
// necesita DENTRO de las mismas transacciones que registran el paquete/
// la transicion (registrarPaqueteBasico, transicionar, cerrarEnvio,
// recibirEnvio), y llamar a getCompanyConfig() (memoizada con
// React.cache(), usa el cliente `prisma` de nivel superior) desde DENTRO
// de un `tx` interactivo se bloquea para siempre bajo
// connection_limit=1 — mismo motivo ya documentado en
// registrarPagoEnTx()/package-transitions.ts.
import type { Prisma } from '@prisma/client';

export interface IdentidadInstalacion {
  codigo: string;
  nombre: string;
}

/**
 * Identidad PUBLICA de ESTA instalacion (Company.sucursalCodigo/
 * sucursalNombre). `null` si todavia no se configuro (instalacion nueva,
 * o una que deliberadamente no participa de Tracking) — el llamador debe
 * tratar eso como "no se puede emitir ningun evento de tracking
 * todavia", nunca como un error que interrumpa la operacion real (Fase
 * 5.3D: Tracking nunca puede romper una operacion local).
 */
export async function obtenerIdentidadInstalacion(tx: Prisma.TransactionClient): Promise<IdentidadInstalacion | null> {
  const company = await tx.company.findUnique({ where: { id: 1 }, select: { sucursalCodigo: true, sucursalNombre: true } });
  if (!company?.sucursalCodigo || !company?.sucursalNombre) return null;
  return { codigo: company.sucursalCodigo, nombre: company.sucursalNombre };
}

export interface IdentidadPaquete {
  origenSucursalCodigo: string;
  origenSucursalNombre: string;
  codigo: string;
}

export interface PaqueteParaIdentidad {
  code: string;
  origenSucursalCodigo: string | null;
  origenCodigoPaquete: string | null;
  /**
   * Envio.transferenciaId (de la instalación de ORIGEN) que trajo este
   * paquete — solo tiene sentido junto con origenSucursalCodigo. Se usa
   * exclusivamente para la delegación de eventos post-interop (Fase
   * 5.3-HARDENING, ver eventos.ts) — nunca para resolver la identidad de
   * tracking en sí. Opcional: los llamadores que no necesitan delegar
   * (registrarPaqueteBasico, entregaExcepcional — siempre paquetes
   * nativos) no lo pasan.
   */
  origenTransferenciaId?: string | null;
}

/**
 * Resuelve la identidad de tracking de un paquete:
 *  - Nativo de esta instalacion (origenSucursalCodigo=null, el 100% de
 *    los paquetes registrados por Recepcion/Envios de aqui hoy): usa la
 *    identidad de ESTA instalacion + su propio "code".
 *  - Materializado aqui por una transferencia real entre instalaciones
 *    (Fase 4.4, materializarRecepcionRemota — origenSucursalCodigo ya
 *    viene grabado en el paquete): usa esa identidad de ORIGEN, nunca la
 *    de esta instalacion, y "origenCodigoPaquete" en vez del "code"
 *    local (pueden no coincidir en texto — ver comentario del schema).
 *    "origenSucursalNombre" no se guarda en Package (solo el codigo) —
 *    se busca en el catalogo local de SucursalDestino por ese codigo
 *    (asumiendo configuracion reciproca normal entre sucursales); si esa
 *    instalacion todavia no esta en el catalogo local, se usa el propio
 *    codigo como nombre de respaldo — nunca se bloquea el evento por
 *    esto (ver limitacion documentada en el informe de esta fase).
 */
export async function resolverIdentidadPaquete(
  tx: Prisma.TransactionClient,
  pkg: PaqueteParaIdentidad,
  instalacion: IdentidadInstalacion
): Promise<IdentidadPaquete> {
  if (!pkg.origenSucursalCodigo) {
    return { origenSucursalCodigo: instalacion.codigo, origenSucursalNombre: instalacion.nombre, codigo: pkg.code };
  }

  const destino = await tx.sucursalDestino.findUnique({ where: { codigo: pkg.origenSucursalCodigo }, select: { nombre: true } });
  return {
    origenSucursalCodigo: pkg.origenSucursalCodigo,
    origenSucursalNombre: destino?.nombre ?? pkg.origenSucursalCodigo,
    codigo: pkg.origenCodigoPaquete ?? pkg.code,
  };
}
