// src/lib/etiquetas-layout.ts
// Distribucion fisica de las etiquetas dentro de una hoja: 3 columnas x
// 10 filas, LLENADO POR COLUMNAS (se completa la columna 1 de arriba a
// abajo, luego la columna 2, luego la 3) — asi luce el documento Word de
// referencia. Funcion pura, sin Prisma/pdf-lib/bwip-js, para poder
// usarse tanto en el generador de PDF (servidor) como en la vista previa
// (cliente) sin duplicar la logica de distribucion.
export const COLS = 3;
export const ROWS = 10;
export const ETIQUETAS_POR_HOJA = COLS * ROWS; // 30

export interface PosicionEtiqueta {
  col: number; // 0-indexado
  row: number; // 0-indexado
}

/**
 * Posicion fisica (columna, fila) de la etiqueta que ocupa el lugar
 * `indexEnHoja` (0-indexado) dentro de una hoja. Llenado por columnas:
 * 0..9 -> columna 0 (filas 0..9), 10..19 -> columna 1, 20..29 -> columna 2.
 */
export function posicionEnHoja(indexEnHoja: number): PosicionEtiqueta {
  return { col: Math.floor(indexEnHoja / ROWS), row: indexEnHoja % ROWS };
}
