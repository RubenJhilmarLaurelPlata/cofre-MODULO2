// src/lib/interop/index.ts
// Fase 4.2: punto de entrada único de la capa de autenticación
// inter-sucursales. Ver README.md de esta carpeta para el protocolo
// completo. Solo re-exporta — nunca agregar lógica nueva aquí.
export { CABECERA_SUCURSAL, CABECERA_TIMESTAMP, CABECERA_NONCE, CABECERA_FIRMA, VENTANA_TIMESTAMP_SEGUNDOS_DEFAULT } from './constantes';
export { construirCanonicalRequest, sha256Hex, type CanonicalRequestInput } from './canonical';
export { firmarRequest, compararTimingSafe } from './firma';
export { crearHeadersInterop, type CrearHeadersInteropInput, type HeadersInterop } from './headers';
export { verificarFirmaInterop, type VerificarFirmaInteropInput, type CabecerasInteropEntrada, type ResultadoVerificacionInterop, type MotivoRechazoInterop } from './verificar';
export { crearAlmacenNonceEnMemoria, almacenNonceInteropPorDefecto, type AlmacenNonceInterop } from './nonce';
export { enmascararValorSensible } from './enmascarado';
export { verificarRequestInteropNext, type VerificarRequestInteropNextOpts } from './adaptador-next';
export {
  consultarEnvioRemoto,
  recibirEnvioRemoto,
  EnvioInteropNoEncontradoError,
  EnvioInteropNoAutorizadoError,
  EnvioInteropRespuestaInvalidaError,
  type ConsultarEnvioRemotoInput,
  type RecibirEnvioRemotoInput,
} from './cliente';
export type { EnvioInteropDTO, EnvioInteropPaqueteDTO } from './dto';
