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
// Las 7 se tratan como separadores a eliminar, igual que el guion y los
// espacios — nunca se sustituye ni se toca ningun caracter alfanumerico
// real, asi que no hay riesgo de que dos codigos legitimos distintos
// colisionen entre si.
const SEPARADORES_APOSTROFE = /['‘’`´ʼ＇]/g;

export function normalizarCodigo(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(SEPARADORES_APOSTROFE, '')
    .replace(/[\s\-]+/g, '');
}

// A diferencia de normalizarCodigo() (que elimina todo separador para
// comparar/buscar), esta funcion se usa donde el codigo se va a
// IMPRIMIR/ALMACENAR como "code" (el valor oficial y visible del
// paquete, ver Package.code en prisma/schema.prisma): convierte
// unicamente las variantes de apostrofe/acento que el S700 puede enviar
// en vez del guion (ver lista arriba), sin tocar espacios ni ningun otro
// caracter, para que un paquete creado a partir de ese escaneo quede
// guardado con el mismo formato "M15A-1" que tiene impreso en su
// etiqueta — nunca con "M15A'1" ni "M15A´1". Se usa en Recepcion (donde
// se crea el "code" de un paquete nuevo) y tambien para lo que se
// MUESTRA en pantalla en Entrega/Buscador (nunca debe verse un
// apostrofe/acento en la interfaz aunque el lector lo haya enviado, solo
// se usa para buscar via normalizarCodigo() ahi, nunca para crear).
export function canonicalizarSeparadores(code: string): string {
  return code.replace(SEPARADORES_APOSTROFE, '-');
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
 */
export function normalizarEntradaEscaneo(raw: string): string {
  return canonicalizarSeparadores(raw.trim()).toUpperCase();
}
