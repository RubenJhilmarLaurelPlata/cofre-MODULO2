// src/lib/etiquetas-pdf.ts
// Arma el PDF de etiquetas listo para imprimir. Geometria y tipografia
// reproducen exactamente el documento Word de referencia
// (Cofre_Express_ejemplos_etiquetas.docx): hoja carta, 3 columnas x 10
// filas (30 etiquetas por hoja), margenes de 259 twips (12.95pt), columnas
// de 3907 twips (195.37pt) sin separacion entre si (solo el borde de la
// celda las divide), filas de 1532 twips (76.61pt), borde solido negro de
// 14 octavos de punto (1.75pt). Codigo grande y en negrita = elemento
// principal; codigo de barras Code128 debajo; fecha de ingreso al final,
// siempre en una sola linea. El orden fisico de llenado (por columnas,
// no por filas) vive en etiquetas-layout.ts, compartido con la vista
// previa para que ambos muestren siempre la misma distribucion.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import bwipjs from 'bwip-js/node';
import type { LabelDescriptor } from '@/lib/etiquetas';
import { COLS, ROWS, ETIQUETAS_POR_HOJA, posicionEnHoja } from '@/lib/etiquetas-layout';

export { ETIQUETAS_POR_HOJA };

const PAGE_WIDTH = 612; // 8.5in a 72pt/in (carta)
const PAGE_HEIGHT = 792; // 11in

const MARGIN = 259 / 20; // 12.95pt — igual al margen del documento Word de referencia
const LABEL_W = (PAGE_WIDTH - 2 * MARGIN) / COLS; // 195.37pt
const LABEL_H = (PAGE_HEIGHT - 2 * MARGIN) / ROWS; // 76.61pt

const BORDER_WIDTH = 14 / 8; // 1.75pt — igual al borde del Word de referencia (w:sz=14)
const BORDER_COLOR = rgb(0, 0, 0);

const CELL_PADDING = 4;
// Aire entre el codigo grande y el barcode (mayor, es lo que se pidio
// "abrir" en esta fase) vs. aire entre el barcode y la fecha (mas
// discreto, como ya estaba).
const GAP_CODE_BARCODE_MAX = 9;
const GAP_CODE_BARCODE_MIN = 4;
const GAP_BARCODE_FECHA_MAX = 4;
const GAP_BARCODE_FECHA_MIN = 2;

const CODE_FONT_SIZE_MAX = 35; // igual al tamaño del codigo en el Word de referencia
const CODE_FONT_SIZE_MIN = 16; // el codigo solo baja de aqui si de verdad no entra
const FECHA_FONT_SIZE_MAX = 8;
const FECHA_FONT_SIZE_MIN = 5;

// Barcode moderadamente mas pequeño que antes (antes 0.42/0.28): sigue
// siendo Code128 perfectamente legible/decodificable, pero deja de
// dominar la etiqueta y le da protagonismo al codigo grande.
const BARCODE_H_RATIO_MAX = 0.3;
const BARCODE_H_RATIO_MIN = 0.18;

function fmtFechaEtiqueta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

async function generarBarcodePng(code: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: code,
    scale: 3,
    height: 10,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

/** Tamaño de fuente mas grande (hasta `max`) que permite que `texto` entre en una sola linea de ancho `maxWidth`. Nunca baja de `min`. */
function ajustarTamanoParaAncho(font: PDFFont, texto: string, maxWidth: number, max: number, min: number): number {
  let size = max;
  while (size > min && font.widthOfTextAtSize(texto, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

function dibujarBordeCelda(page: PDFPage, x: number, topY: number) {
  page.drawRectangle({
    x,
    y: topY - LABEL_H,
    width: LABEL_W,
    height: LABEL_H,
    borderColor: BORDER_COLOR,
    borderWidth: BORDER_WIDTH,
  });
}

function dibujarEtiqueta(
  page: PDFPage,
  descriptor: LabelDescriptor,
  barcodeImg: PDFImage,
  posicion: { col: number; row: number },
  fonts: { bold: PDFFont; regular: PDFFont }
) {
  const cellX = MARGIN + posicion.col * LABEL_W;
  const cellTopY = PAGE_HEIGHT - MARGIN - posicion.row * LABEL_H;

  dibujarBordeCelda(page, cellX, cellTopY);

  const innerW = LABEL_W - CELL_PADDING * 2;
  const innerH = LABEL_H - CELL_PADDING * 2;

  const fechaTexto = `Fecha de ingreso: ${fmtFechaEtiqueta(descriptor.fecha)}`;

  let codeSize = ajustarTamanoParaAncho(fonts.bold, descriptor.code, innerW, CODE_FONT_SIZE_MAX, CODE_FONT_SIZE_MIN);
  // La fecha se ajusta primero — el codigo nunca se reduce por culpa de la fecha (solo por su propio ancho).
  const fechaSize = ajustarTamanoParaAncho(fonts.regular, fechaTexto, innerW, FECHA_FONT_SIZE_MAX, FECHA_FONT_SIZE_MIN);

  let gapCodeBarcode = GAP_CODE_BARCODE_MAX;
  let gapBarcodeFecha = GAP_BARCODE_FECHA_MAX;
  let barcodeRatio = BARCODE_H_RATIO_MAX;

  function medir(size: number, gCodeBarcode: number, gBarcodeFecha: number, ratio: number) {
    const codeH = fonts.bold.heightAtSize(size, { descender: false });
    const fechaH = fonts.regular.heightAtSize(fechaSize, { descender: true });
    const barcodeMaxH = LABEL_H * ratio;
    const { width: bcW, height: bcH } = barcodeImg.scaleToFit(innerW, barcodeMaxH);
    const total = codeH + gCodeBarcode + bcH + gBarcodeFecha + fechaH;
    return { codeH, fechaH, bcW, bcH, total };
  }

  let medida = medir(codeSize, gapCodeBarcode, gapBarcodeFecha, barcodeRatio);

  // Si no entra verticalmente: primero se compacta el espaciado (el aire
  // entre codigo y barcode se sacrifica antes que el de barcode/fecha),
  // luego se reduce el codigo de barras, y solo como ultimo recurso se
  // reduce el codigo (nunca la fecha, que ya se ajusto a su propio ancho).
  while (medida.total > innerH && gapCodeBarcode > GAP_CODE_BARCODE_MIN) {
    gapCodeBarcode -= 0.5;
    medida = medir(codeSize, gapCodeBarcode, gapBarcodeFecha, barcodeRatio);
  }
  while (medida.total > innerH && gapBarcodeFecha > GAP_BARCODE_FECHA_MIN) {
    gapBarcodeFecha -= 0.5;
    medida = medir(codeSize, gapCodeBarcode, gapBarcodeFecha, barcodeRatio);
  }
  while (medida.total > innerH && barcodeRatio > BARCODE_H_RATIO_MIN) {
    barcodeRatio -= 0.02;
    medida = medir(codeSize, gapCodeBarcode, gapBarcodeFecha, barcodeRatio);
  }
  while (medida.total > innerH && codeSize > CODE_FONT_SIZE_MIN) {
    codeSize -= 0.5;
    medida = medir(codeSize, gapCodeBarcode, gapBarcodeFecha, barcodeRatio);
  }

  const { fechaH, bcW, bcH } = medida;

  // Apilado de abajo hacia arriba: fecha -> barcode -> codigo (el orden visual de arriba a abajo es codigo, barcode, fecha).
  const cellBottomY = cellTopY - LABEL_H;
  const fechaBaselineY = cellBottomY + CELL_PADDING;
  const fechaWidth = fonts.regular.widthOfTextAtSize(fechaTexto, fechaSize);
  page.drawText(fechaTexto, {
    x: cellX + (LABEL_W - fechaWidth) / 2,
    y: fechaBaselineY,
    size: fechaSize,
    font: fonts.regular,
    color: rgb(0.2, 0.2, 0.2),
  });

  const barcodeY = fechaBaselineY + fechaH + gapBarcodeFecha;
  page.drawImage(barcodeImg, {
    x: cellX + (LABEL_W - bcW) / 2,
    y: barcodeY,
    width: bcW,
    height: bcH,
  });

  const codeWidth = fonts.bold.widthOfTextAtSize(descriptor.code, codeSize);
  const codeY = barcodeY + bcH + gapCodeBarcode;
  page.drawText(descriptor.code, {
    x: cellX + (LABEL_W - codeWidth) / 2,
    y: codeY,
    size: codeSize,
    font: fonts.bold,
    color: rgb(0, 0, 0),
  });
}

async function embedBarcode(pdf: PDFDocument, code: string) {
  const png = await generarBarcodePng(code);
  return pdf.embedPng(png);
}

export async function construirPdfEtiquetas(codigos: LabelDescriptor[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Etiquetas Cofre Express');
  pdf.setProducer('Cofre Express');

  const fonts = {
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    regular: await pdf.embedFont(StandardFonts.Helvetica),
  };

  const totalPaginas = Math.max(Math.ceil(codigos.length / ETIQUETAS_POR_HOJA), 1);

  for (let p = 0; p < totalPaginas; p++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const slice = codigos.slice(p * ETIQUETAS_POR_HOJA, (p + 1) * ETIQUETAS_POR_HOJA);

    for (const [idx, descriptor] of slice.entries()) {
      const barcodeImg = await embedBarcode(pdf, descriptor.code);
      dibujarEtiqueta(page, descriptor, barcodeImg, posicionEnHoja(idx), fonts);
    }
  }

  return pdf.save();
}
