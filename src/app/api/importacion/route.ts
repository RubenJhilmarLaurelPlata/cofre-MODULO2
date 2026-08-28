// src/app/api/importacion/route.ts
// Importacion masiva de codigos. Un solo endpoint con 3 acciones
// (detectar-columnas / previsualizar / confirmar): siempre vuelve a
// parsear y validar el archivo contra la base de datos real en el
// servidor — nunca confia en un resumen que haya vuelto del cliente,
// para que nadie pueda alterar la validacion antes de confirmar.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { extraerContextoRequest } from '@/lib/auditoria';
import {
  parseCSV,
  parseTXT,
  parseXLSX,
  detectarEncabezados,
  validarFilas,
  aplicarEdicionesFilas,
  aplicarExclusionesFilas,
  ejecutarImportacion,
  registrarImportLog,
  type FormatoImportacion,
  type FilaImportacion,
  type CampoSistema,
  type TipoImportacion,
  type OpcionesFechaRecepcion,
  type EdicionFila,
} from '@/lib/importacion';

const MAX_BYTES = 8_000_000;
const MAX_FILAS = 10_000;

function detectarFormato(nombreArchivo: string): FormatoImportacion | null {
  const ext = nombreArchivo.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'CSV';
  if (ext === 'xlsx') return 'XLSX';
  if (ext === 'txt') return 'TXT';
  return null;
}

const TIPOS_VALIDOS: TipoImportacion[] = ['SOLO_REGISTRAR', 'MARCAR_ENTREGADOS', 'CREAR_Y_ENTREGAR', 'CREAR_EN_DEPOSITO'];

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'No se pudo leer el archivo enviado.' }, { status: 400 });
  }

  const accion = String(formData.get('accion') ?? 'previsualizar');
  if (!['detectar-columnas', 'previsualizar', 'confirmar'].includes(accion)) {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Adjunta un archivo CSV o XLSX.' }, { status: 400 });
  }
  const nombreLote = String(formData.get('nombreLote') ?? '').trim().slice(0, 120) || undefined;
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo es demasiado grande (máximo 8MB).' }, { status: 400 });
  }

  const formato = detectarFormato(file.name);
  if (!formato) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xls') {
      return NextResponse.json(
        { error: 'El formato .xls (Excel 97-2003) no está soportado. Ábrelo en Excel/Sheets y guárdalo como .xlsx o .csv — toma dos clics.' },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Formato no reconocido. Usa un archivo .csv o .xlsx.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Paso 1: solo detectar encabezados para el mapeador visual. No
    // valida filas ni escribe nada.
    if (accion === 'detectar-columnas') {
      const deteccion = await detectarEncabezados(formato, buffer);
      return NextResponse.json(deteccion);
    }

    // Mapeo explicito confirmado por el administrador en el mapeador
    // (array paralelo a los encabezados detectados, en el mismo orden).
    // Si no viene, se usa la deteccion automatica de siempre (TXT nunca
    // lo necesita: es una lista de codigos sin columnas).
    const mapeoRaw = formData.get('mapeo');
    let mapeo: Array<CampoSistema | null> | undefined;
    if (typeof mapeoRaw === 'string' && mapeoRaw.trim()) {
      try {
        const parsed = JSON.parse(mapeoRaw);
        if (Array.isArray(parsed)) mapeo = parsed;
      } catch {
        return NextResponse.json({ error: 'El mapeo de columnas enviado no es válido.' }, { status: 400 });
      }
    }

    let filas: FilaImportacion[];
    if (formato === 'TXT') filas = parseTXT(buffer.toString('utf-8'));
    else if (formato === 'CSV') filas = parseCSV(buffer.toString('utf-8'), mapeo);
    else filas = await parseXLSX(buffer, mapeo);

    // Ediciones del administrador hechas en la previsualizacion (código,
    // monto, persona que recoge, celular) — se aplican ANTES de validar,
    // nunca despues (ver comentario de aplicarEdicionesFilas en
    // src/lib/importacion.ts).
    const edicionesRaw = formData.get('ediciones');
    if (typeof edicionesRaw === 'string' && edicionesRaw.trim()) {
      try {
        const parsed = JSON.parse(edicionesRaw);
        if (Array.isArray(parsed)) filas = aplicarEdicionesFilas(filas, parsed as EdicionFila[]);
      } catch {
        return NextResponse.json({ error: 'Las ediciones enviadas no son válidas.' }, { status: 400 });
      }
    }

    // Filas que el administrador quitó de la previsualización antes de
    // confirmar (botón "Eliminar" por fila) — se descartan ANTES de
    // validarFilas(), igual criterio que las ediciones de arriba: el
    // servidor es quien realmente decide qué se procesa, nunca confía en
    // que el cliente ya las haya omitido del archivo (ver
    // aplicarExclusionesFilas en src/lib/importacion.ts). Una fila
    // excluida nunca genera ImportRow, nunca puede crear Package/Pago/
    // PackageHistory, y no afecta ningún conteo.
    const exclusionesRaw = formData.get('exclusiones');
    if (typeof exclusionesRaw === 'string' && exclusionesRaw.trim()) {
      try {
        const parsed = JSON.parse(exclusionesRaw);
        if (Array.isArray(parsed)) filas = aplicarExclusionesFilas(filas, parsed as number[]);
      } catch {
        return NextResponse.json({ error: 'Las filas eliminadas enviadas no son válidas.' }, { status: 400 });
      }
    }

    if (filas.length === 0) {
      return NextResponse.json({ error: 'El archivo no tiene filas para importar.' }, { status: 400 });
    }
    if (filas.length > MAX_FILAS) {
      return NextResponse.json({ error: `El archivo tiene demasiadas filas (máximo ${MAX_FILAS.toLocaleString('es-BO')} por importación).` }, { status: 400 });
    }

    // Fecha de recepcion de esta lista (opcional): "unica" aplica la misma
    // fecha a todas las filas, "por_fila" interpreta la columna
    // fechaRecepcion de cada una — ver validarFilas() en
    // src/lib/importacion.ts. Si no se envia nada, el comportamiento es
    // exactamente el de siempre (ingresoAt = entregaAt para paquetes
    // nuevos).
    const modoFechaRaw = String(formData.get('modoFechaRecepcion') ?? '');
    const fechaRecepcionUnicaRaw = formData.get('fechaRecepcionUnica');
    let opcionesFecha: OpcionesFechaRecepcion | undefined;
    if (modoFechaRaw === 'por_fila') {
      opcionesFecha = { modo: 'por_fila' };
    } else if (modoFechaRaw === 'unica') {
      const fechaUnica = typeof fechaRecepcionUnicaRaw === 'string' ? fechaRecepcionUnicaRaw.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaUnica)) {
        return NextResponse.json({ error: 'Selecciona una fecha de recepción válida para toda la lista.' }, { status: 400 });
      }
      opcionesFecha = { modo: 'unica', fechaUnica };
    }

    // Monto por defecto (Problema 3): si la fila no trae un monto valido
    // (columna ausente o celda vacia), se usa la tarifa base configurada
    // (Configuración → Tarifas, hoy Bs 2) — nunca un numero fijo aparte de
    // esa configuracion. Sigue siendo editable fila por fila.
    const company = await getCompanyConfig();
    const resumen = await validarFilas(filas, opcionesFecha, company.tarifaBase);

    if (accion === 'previsualizar') {
      return NextResponse.json({ resumen });
    }

    // accion === 'confirmar'
    const tipoRaw = String(formData.get('tipo') ?? '');
    if (!TIPOS_VALIDOS.includes(tipoRaw as TipoImportacion)) {
      return NextResponse.json({ error: 'Selecciona un tipo de importación válido.' }, { status: 400 });
    }
    const tipo = tipoRaw as TipoImportacion;

    // Importar en depósito exige una fecha de ingreso real para cada fila
    // (ver REGLA 11-13 de la especificación: sin fecha no hay forma de
    // calcular cuántos días lleva en depósito) — se revalida aquí en el
    // servidor, nunca se confía en que el frontend haya obligado a
    // elegirla (ver REGLA 9, "el backend es la autoridad").
    if (tipo === 'CREAR_EN_DEPOSITO' && !opcionesFecha) {
      return NextResponse.json(
        { error: 'Para importar en depósito, selecciona la fecha de recepción de la lista (paso 2) — es obligatoria para calcular los días en depósito.' },
        { status: 400 }
      );
    }

    const branchId = session.branchId ?? company.sucursalActualId ?? (await prisma.branch.findFirst({ where: { activo: true } }))?.id;
    if (!branchId) {
      return NextResponse.json({ error: 'No hay ninguna sucursal activa configurada.' }, { status: 400 });
    }

    const resultado = await ejecutarImportacion(resumen, tipo, session.id, branchId, company.tarifaBase);
    const importLogId = await registrarImportLog({
      nombreArchivo: file.name,
      nombreLote,
      formato,
      resumen,
      resultado,
      userId: session.id,
    });

    const { ip, userAgent } = extraerContextoRequest(req);
    return NextResponse.json({ resumen, resultado, importLogId, ip, userAgent });
  } catch (err) {
    console.error('Error en importación masiva:', err);
    const mensaje = err instanceof Error ? err.message : 'Ocurrió un error al procesar el archivo.';
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
}
