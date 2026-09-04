// src/lib/codigo.ts
// La representacion "oficial" de un codigo (la que se imprime y se
// muestra) siempre lleva guion, ej. "M24J-125". Pero al escanear o
// tipear, el mismo codigo puede llegar como "M24J125", "m24j125" o
// "M24J 125" — todos deben encontrar el mismo paquete. Esta funcion es
// el unico lugar donde se define esa normalizacion; Package.codigoNormalizado
// se calcula con ella una sola vez al crear el paquete (ver prisma/schema.prisma).
//
// El Socket Mobile S700 en modo HID, segun el layout de teclado con el
// que quedo configurado (y algunos moviles/teclados virtuales al
// autocorregir), puede enviar cualquiera de estas variantes en vez del
// guion del codigo (ej. "M15A'1" o "M15A´1" en vez de "M15A-1"):
//   ' (U+0027 apostrofe recto)       ' (U+2019 comilla simple derecha)
//   ' (U+2018 comilla simple izq.)   ` (U+0060 acento grave)
//   ´ (U+00B4 acento agudo)          ʼ (U+02BC letra modificadora apostrofe)
//   ＇ (U+FF07 apostrofe ancho completo, IME/teclados en japones-chino-coreano)
//
// El lector KNUP KP-1018A (HID), segun su configuracion, puede en cambio
// enviar cualquiera de estos otros caracteres en el mismo lugar:
//   / (U+002F barra)                 \ (U+005C barra invertida)
//   _ (U+005F guion bajo)            – (U+2013 guion medio/en dash)
//   — (U+2014 raya/em dash)          − (U+2212 signo menos matematico)
// Ningun lector real esta garantizado a mandar siempre el mismo
// caracter (depende de firmware/idioma de teclado configurado), asi que
// las 13 variantes de arriba se tratan TODAS igual, junto con el guion
// real y los espacios: son "separadores equivalentes" — nunca se toca
// ningun caracter alfanumerico real, asi que no hay riesgo de que dos
// codigos legitimos distintos colisionen entre si.
const SEPARADORES_EQUIVALENTES = /['‘’`´ʼ＇/\\_–—−]/g;

export function normalizarCodigo(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(SEPARADORES_EQUIVALENTES, '')
    .replace(/[\s\-]+/g, '');
}

// A diferencia de normalizarCodigo() (que elimina todo separador para
// comparar/buscar), esta funcion se usa donde el codigo se va a
// IMPRIMIR/ALMACENAR como "code" (el valor oficial y visible del
// paquete, ver Package.code en prisma/schema.prisma): convierte
// cualquier separador equivalente (ver lista arriba) al guion "-", que
// es el UNICO separador canonico del sistema, sin tocar ningun otro
// caracter, para que un paquete creado a partir de ese escaneo quede
// guardado con el mismo formato "M15A-1" que tiene impreso en su
// etiqueta — nunca con "M15A'1", "M15A´1" ni "M15A/1". Tambien colapsa
// espacios pegados al separador ("M19A / 29" -> "M19A-29", no
// "M19A - 29") y guiones consecutivos ("M19A--29" -> "M19A-29"), para
// que el resultado sea siempre una unica forma canonica. Se usa en
// Recepcion (donde se crea el "code" de un paquete nuevo), en
// Importacion (donde se crea el "code" de un paquete faltante) y para lo
// que se MUESTRA en pantalla en Entrega/Buscador (nunca debe verse un
// separador distinto de "-" en la interfaz aunque el lector lo haya
// enviado, solo se usa para buscar via normalizarCodigo() ahi, nunca
// para crear).
export function canonicalizarSeparadores(code: string): string {
  return code
    .replace(SEPARADORES_EQUIVALENTES, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/-{2,}/g, '-');
}

/**
 * Punto unico de normalizacion del lado del cliente: se llama al RECIBIR
 * el escaneo (lector USB/HID, camara, CaptureSDK, o tecleo manual con
 * Enter), antes de mostrar nada en pantalla y antes de mandarlo a
 * cualquier API — nunca despues. Usada por Recepcion, Entrega, Buscador,
 * Deposito (Enviar/Bajar) y el escaner de camara, para que las cuatro
 * pantallas conviertan "L17A'29" en "L17A-29" exactamente de la misma
 * forma, en el mismo instante. El backend vuelve a normalizar por su
 * cuenta (nunca confia solo en el cliente), pero la interfaz nunca debe
 * llegar a mostrar un apostrofe/acento aunque el lector lo haya enviado.
 *
 * "Envios -> Recibir envio" es la unica pantalla cuyo escaneo (QR, via
 * camera-scanner.tsx) puede traer un payload "codigo|qrToken" (ver
 * buscarEnvioParaRecibir() en src/lib/envios.ts) — el qrToken es un
 * crypto.randomUUID() en minusculas, comparado con `===` contra el valor
 * guardado en BD, asi que NO puede pasar por .toUpperCase() ni por
 * canonicalizarSeparadores() como el resto del texto o deja de coincidir
 * (bug real de produccion: la camara detectaba el QR real, pero el
 * token quedaba en mayusculas y el backend respondia "no encontrado").
 * Un codigo de paquete/envio real nunca contiene "|", asi que separar
 * aqui es un cambio seguro para los otros 7 puntos de llamada — cuando
 * no hay "|" el comportamiento es exactamente el de antes.
 */
export function normalizarEntradaEscaneo(raw: string): string {
  const trimmed = raw.trim();
  const separador = trimmed.indexOf('|');
  if (separador === -1) return canonicalizarSeparadores(trimmed).toUpperCase();
  const codigo = canonicalizarSeparadores(trimmed.slice(0, separador)).toUpperCase();
  const token = trimmed.slice(separador + 1).trim();
  return `${codigo}|${token}`;
}
