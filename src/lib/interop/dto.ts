// src/lib/interop/dto.ts
// Fase 4.3: forma exacta de lo que UNA instalación expone a OTRA sobre un
// Envío, vía /api/interop/envios/[codigo]. Deliberadamente NO es
// EnvioDetalleDTO (src/lib/envios.ts) — ese DTO está pensado para el
// FRONTEND de esta misma instalación y expone cosas que nunca deben
// salir por la red hacia otra instalación:
//
//   - Envio.id / EnvioItem.id / Package.id: claves primarias RELACIONALES
//     internas de esta base de datos — no tienen significado ni utilidad
//     para quien recibe la respuesta, y exponerlas no aporta nada más
//     que superficie de ataque.
//   - creadoPor / cerradoPor (nombres de USUARIOS de esta instalación):
//     información administrativa/interna de personal — la otra
//     instalación no necesita saber QUIÉN operó, solo QUÉ se transfiere.
//   - resumenPago completo (incluye "pendientes" como conteo agregado
//     pensado para una pantalla): se resume aquí a lo mínimo que el
//     destino necesita por paquete (ver EnvioInteropPaqueteDTO) para
//     poder calcular sus propios fondos si hace falta, no la vista ya
//     armada para un operador.
//
// Este archivo es SOLO tipos — no consulta nada. Quien arma un valor real
// de este tipo es getEnvioParaInterop() (src/lib/interop-envios.ts, capa
// de dominio con Prisma), a partir del modelo real (revisado antes de
// definir estos campos — ver Envio/EnvioItem/Package en schema.prisma).

export interface EnvioInteropPaqueteDTO {
  /** Package.code EN LA INSTALACIÓN DE ORIGEN — ver la advertencia de Fase 4.1: nunca asumir que es único fuera de esa instalación. Quien recibe este DTO debe tratarlo junto con el código de sucursal de origen (ver EnvioInteropDTO.origen.codigo) como el par que realmente identifica al paquete. */
  codigo: string;
  destinatario: string | null;
  destinatarioTelefono: string | null;
  estadoPago: 'PENDIENTE' | 'PAGADO';
  /** Monto cobrado en origen que corresponde al destino (ver EnvioItem.montoPagado) — nunca una tarifa recalculada. */
  montoPagado: number;
}

export interface EnvioInteropDTO {
  /**
   * Envio.transferenciaId (Fase 4.1) — identidad técnica y estable de
   * esta transferencia, para uso de la Fase 4.4 (idempotencia de la
   * recepción). Puede ser null solo para envíos creados ANTES de la
   * migración de Fase 4.1 (legado) — nunca para uno nuevo.
   */
  transferenciaId: string | null;
  /** Envio.codigo — visible, ej. "ENV-20260904-001". */
  codigo: string;
  /** BORRADOR | CERRADO | CANCELADO | RECIBIDO — en la práctica, este endpoint solo devuelve envíos CERRADO/RECIBIDO (ver getEnvioParaInterop). */
  estado: string;
  /** Identidad de la instalación que RESPONDE esta consulta (Company.sucursalCodigo/sucursalNombre, Fase 1) — nunca un valor fijo. */
  origen: { codigo: string | null; nombre: string | null };
  /** La sucursal a la que este envío está destinado, tal como la conoce la instalación de origen (SucursalDestino.codigo/nombre). */
  destino: { codigo: string; nombre: string };
  cantidadPaquetes: number;
  paquetes: EnvioInteropPaqueteDTO[];
  /** ISO 8601, o null si el envío nunca se cerró (no debería ocurrir: ver filtro de estado en getEnvioParaInterop). */
  cerradoAt: string | null;
}

// Decisión de diseño explícita (Fase 4.3, consultada con el dueño del
// producto antes de implementarse): este DTO de SOLO CONSULTA
// deliberadamente NO incluye Envio.qrToken.
//
// Motivo: quien llama a este endpoint (la sucursal destino) YA posee el
// qrToken — lo acaba de leer del QR físico impreso, antes de siquiera
// hacer esta consulta (ver flujo de recibir-envio-client.tsx). Reenviarlo
// de vuelta en la respuesta sería un secreto de un solo propósito
// viajando por un lugar de más, sin ganar ninguna validación real: la
// pregunta que de verdad importa — "¿el QR que escaneé corresponde al
// lote que estoy por recibir?" — se responde correctamente en la Fase
// 4.4 (recepción remota), cuando el DESTINO envía de vuelta el
// codigo+qrToken que escaneó al POST /recibir del ORIGEN, y el ORIGEN lo
// compara contra su propio Envio.qrToken guardado — exactamente el mismo
// patrón que ya usa hoy buscarEnvioParaRecibir() de forma local, solo que
// ahora por red. Ese intercambio SÍ necesita el token (viaja del destino
// hacia el origen, no al revés) — pero eso es Fase 4.4, no esta.
