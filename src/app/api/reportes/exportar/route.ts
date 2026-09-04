// src/app/api/reportes/exportar/route.ts
// Exporta cualquiera de los 5 reportes en PDF, Excel o CSV, respetando
// los filtros aplicados, y deja registro en ReportLog (auditoria).
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { prisma } from '@/lib/prisma';
import {
  getReportePaquetes,
  getReporteFinanciero,
  getReporteOperadores,
  getReporteDeposito,
  getReporteEtiquetas,
  registrarReporteGenerado,
  resolverRangoFechas,
  type FiltrosReporte,
  type ReporteResultado,
  type TipoReporte,
  type FormatoExportacion,
} from '@/lib/reportes';
import { construirPdfReporte, construirExcelReporte, construirCsvReporte } from '@/lib/reportes-export';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { PACKAGE_STATUSES } from '@/types';


const TITULOS: Record<TipoReporte, string> = {
  PAQUETES: 'Reporte de Paquetes',
  FINANCIERO: 'Reporte Financiero',
  OPERADORES: 'Reporte de Operadores',
  DEPOSITO: 'Reporte de Depósito',
  ETIQUETAS: 'Reporte de Etiquetas',
};

const filtrosSchema = z.object({
  modo: z.enum(['hoy', 'ayer', 'semana', 'mes', 'especifica', 'rango']),
  fecha: z.string().optional(),
  fechaInicio: z.string().optional(),
  fechaFin: z.string().optional(),
  estado: z.enum(PACKAGE_STATUSES).optional(),
  usuarioId: z.string().optional(),
  inicial: z.string().optional(),
  q: z.string().optional(),
});

const bodySchema = z.object({
  tipo: z.enum(['PAQUETES', 'FINANCIERO', 'OPERADORES', 'DEPOSITO', 'ETIQUETAS']),
  formato: z.enum(['PDF', 'EXCEL', 'CSV']),
  filtros: filtrosSchema,
});

async function calcularReporte(tipo: TipoReporte, filtros: FiltrosReporte): Promise<ReporteResultado> {
  switch (tipo) {
    case 'PAQUETES':
      return getReportePaquetes(filtros);
    case 'FINANCIERO':
      return getReporteFinanciero(filtros);
    case 'OPERADORES':
      return getReporteOperadores(filtros);
    case 'DEPOSITO':
      return getReporteDeposito(filtros);
    case 'ETIQUETAS':
      return getReporteEtiquetas(filtros);
  }
}

async function describirFiltros(filtros: FiltrosReporte): Promise<string[]> {
  const partes: string[] = [];
  partes.push(resolverRangoFechas(filtros).etiqueta);
  if (filtros.estado) partes.push(`Estado: ${filtros.estado}`);
  if (filtros.inicial) partes.push(`Tipo: ${filtros.inicial}`);
  if (filtros.q) partes.push(`Búsqueda: "${filtros.q}"`);
  if (filtros.usuarioId) {
    const usuario = await prisma.user.findUnique({ where: { id: filtros.usuarioId }, select: { nombre: true } });
    if (usuario) partes.push(`Usuario: ${usuario.nombre}`);
  }
  return partes;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'reportes.exportar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }
  const { tipo, formato, filtros } = parsed.data;

  try {
    const resultado = await calcularReporte(tipo, filtros);
    const filtrosDescripcion = await describirFiltros(filtros);
    const meta = { titulo: TITULOS[tipo], generadoPor: session.nombre, generadoEl: new Date(), filtrosDescripcion };

    await registrarReporteGenerado(tipo, formato as FormatoExportacion, filtros, session.id);
    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'REPORTE_GENERADO',
      modulo: 'reportes',
      valorNuevo: { tipo, formato, filtros },
      ip,
      userAgent,
    });

    const nombreArchivoBase = `${TITULOS[tipo].toLowerCase().replace(/\s+/g, '-')}-${meta.generadoEl.toISOString().slice(0, 10)}`;

    if (formato === 'PDF') {
      const logoPath = path.join(process.cwd(), 'public', 'logo.jpg');
      const logoBytes = await readFile(logoPath).catch(() => undefined);
      const pdfBytes = await construirPdfReporte(meta, resultado, logoBytes);
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombreArchivoBase}.pdf"` },
      });
    }

    if (formato === 'EXCEL') {
      const excelBuffer = await construirExcelReporte(meta, resultado);
      return new NextResponse(excelBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${nombreArchivoBase}.xlsx"`,
        },
      });
    }

    const csv = construirCsvReporte(meta, resultado);
    return new NextResponse(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombreArchivoBase}.csv"` },
    });
  } catch (err) {
    console.error('Error exportando reporte:', err);
    return NextResponse.json({ error: 'Ocurrió un error al generar el reporte.' }, { status: 500 });
  }
}
