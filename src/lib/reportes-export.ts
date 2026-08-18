// src/lib/reportes-export.ts
// Construye la exportacion de un reporte en PDF, Excel o CSV, siempre a
// partir del mismo ReporteResultado (resumen + tablas) que ya calculo
// reportes.ts — un solo lugar de verdad, sin logica de negocio duplicada
// por formato.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import ExcelJS from 'exceljs';
import type { ReporteResultado } from '@/lib/reportes';

export interface ExportMeta {
  titulo: string;
  generadoPor: string;
  generadoEl: Date;
  filtrosDescripcion: string[];
}

// Hoja carta en horizontal: las tablas de reportes suelen tener muchas
// columnas (hasta 10), y el ancho extra evita truncar demasiado el texto.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

function fmtFechaHora(d: Date): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

function truncar(texto: string, maxChars: number): string {
  return texto.length > maxChars ? `${texto.slice(0, maxChars - 1)}…` : texto;
}

export async function construirPdfReporte(meta: ExportMeta, resultado: ReporteResultado, logoBytes?: Buffer): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.titulo);
  pdf.setProducer('Cofre Express');

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImg = logoBytes ? await pdf.embedJpg(logoBytes).catch(() => null) : null;

  const paginas: PDFPage[] = [];
  let page!: PDFPage;
  let y = PAGE_H - MARGIN;

  function dibujarEncabezado() {
    const logoH = 30;
    let textoX = MARGIN;
    if (logoImg) {
      const logoW = (logoImg.width / logoImg.height) * logoH;
      page.drawImage(logoImg, { x: MARGIN, y: y - logoH, width: logoW, height: logoH });
      textoX = MARGIN + logoW + 12;
    }
    page.drawText(meta.titulo, { x: textoX, y: y - 13, size: 15, font: fontBold, color: rgb(0.06, 0.07, 0.08) });
    page.drawText(`Generado el ${fmtFechaHora(meta.generadoEl)} por ${meta.generadoPor}`, {
      x: textoX,
      y: y - 28,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.45, 0.45, 0.45),
    });
    y -= Math.max(logoH, 30) + 10;

    if (meta.filtrosDescripcion.length > 0) {
      page.drawText(`Filtros: ${truncar(meta.filtrosDescripcion.join(' · '), 110)}`, {
        x: MARGIN,
        y,
        size: 8,
        font: fontRegular,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 14;
    }

    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.9, 0.9, 0.9) });
    y -= 18;
  }

  function nuevaPagina() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    paginas.push(page);
    y = PAGE_H - MARGIN;
    dibujarEncabezado();
  }

  function asegurarEspacio(altura: number) {
    if (y - altura < MARGIN + 24) nuevaPagina();
  }

  nuevaPagina();

  // --- Resumen ---
  asegurarEspacio(20);
  page.drawText('Resumen', { x: MARGIN, y, size: 12, font: fontBold, color: rgb(0.06, 0.07, 0.08) });
  y -= 18;
  for (const item of resultado.resumen) {
    asegurarEspacio(14);
    page.drawText(item.label, { x: MARGIN, y, size: 9, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(truncar(item.value, 60), { x: MARGIN + 230, y, size: 9, font: fontBold, color: rgb(0.06, 0.07, 0.08) });
    y -= 14;
  }
  y -= 12;

  // --- Tablas ---
  for (const tabla of resultado.tablas) {
    asegurarEspacio(32);
    page.drawText(`${tabla.titulo} (${tabla.filas.length})`, { x: MARGIN, y, size: 12, font: fontBold, color: rgb(0.06, 0.07, 0.08) });
    y -= 16;

    const colWidth = CONTENT_W / tabla.columnas.length;
    const maxCharsPorColumna = Math.max(6, Math.floor(colWidth / 4.3));

    function dibujarCabeceraTabla(fuente: PDFFont) {
      page.drawRectangle({ x: MARGIN, y: y - 11, width: CONTENT_W, height: 15, color: rgb(0.96, 0.96, 0.96) });
      tabla.columnas.forEach((c, i) => {
        page.drawText(truncar(c.label, maxCharsPorColumna), { x: MARGIN + i * colWidth + 4, y: y - 8, size: 7.5, font: fuente, color: rgb(0.25, 0.25, 0.25) });
      });
      y -= 17;
    }

    dibujarCabeceraTabla(fontBold);

    if (tabla.filas.length === 0) {
      page.drawText('Sin datos para los filtros seleccionados.', { x: MARGIN + 4, y, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) });
      y -= 14;
    }

    for (const fila of tabla.filas) {
      if (y - 13 < MARGIN + 24) {
        nuevaPagina();
        page.drawText(`${tabla.titulo} (continuación)`, { x: MARGIN, y, size: 10, font: fontBold, color: rgb(0.06, 0.07, 0.08) });
        y -= 15;
        dibujarCabeceraTabla(fontBold);
      }
      tabla.columnas.forEach((c, i) => {
        const valor = truncar(String(fila[c.key] ?? ''), maxCharsPorColumna);
        page.drawText(valor, { x: MARGIN + i * colWidth + 4, y, size: 7.5, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
      });
      y -= 13;
    }
    y -= 14;
  }

  const total = paginas.length;
  paginas.forEach((p, i) => {
    p.drawText(`Página ${i + 1} de ${total}  ·  Cofre Express`, { x: MARGIN, y: 20, size: 7.5, font: fontRegular, color: rgb(0.6, 0.6, 0.6) });
  });

  return pdf.save();
}

export async function construirExcelReporte(meta: ExportMeta, resultado: ReporteResultado): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cofre Express';
  workbook.created = meta.generadoEl;

  const resumenSheet = workbook.addWorksheet('Resumen');
  resumenSheet.columns = [{ width: 32 }, { width: 40 }];
  resumenSheet.addRow([meta.titulo]).font = { bold: true, size: 14 };
  resumenSheet.addRow([`Generado el ${fmtFechaHora(meta.generadoEl)} por ${meta.generadoPor}`]).font = { italic: true, color: { argb: 'FF666666' } };
  if (meta.filtrosDescripcion.length > 0) {
    resumenSheet.addRow([`Filtros: ${meta.filtrosDescripcion.join(' · ')}`]).font = { size: 9, color: { argb: 'FF888888' } };
  }
  resumenSheet.addRow([]);
  const headerRow = resumenSheet.addRow(['Indicador', 'Valor']);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2660F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (const item of resultado.resumen) {
    resumenSheet.addRow([item.label, item.value]);
  }

  for (const tabla of resultado.tablas) {
    const sheetName = tabla.titulo.slice(0, 31).replace(/[[\]*/\\?:]/g, ' ');
    const sheet = workbook.addWorksheet(sheetName || 'Datos');
    sheet.columns = tabla.columnas.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2660F' } };
    });
    for (const fila of tabla.filas) sheet.addRow(fila);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tabla.columnas.length } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function escaparCsv(valor: string | number): string {
  const texto = String(valor);
  if (/[",\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function construirCsvReporte(meta: ExportMeta, resultado: ReporteResultado): string {
  const lineas: string[] = [];
  lineas.push(escaparCsv(meta.titulo));
  lineas.push(escaparCsv(`Generado el ${fmtFechaHora(meta.generadoEl)} por ${meta.generadoPor}`));
  lineas.push('');
  lineas.push('Indicador,Valor');
  for (const item of resultado.resumen) lineas.push([escaparCsv(item.label), escaparCsv(item.value)].join(','));

  for (const tabla of resultado.tablas) {
    lineas.push('');
    lineas.push(escaparCsv(tabla.titulo));
    lineas.push(tabla.columnas.map((c) => escaparCsv(c.label)).join(','));
    for (const fila of tabla.filas) {
      lineas.push(tabla.columnas.map((c) => escaparCsv(fila[c.key] ?? '')).join(','));
    }
  }

  // BOM al inicio para que Excel detecte UTF-8 correctamente.
  return `﻿${lineas.join('\r\n')}`;
}
