// src/lib/importacion.ts
// Importacion masiva de codigos (Fase 2): registrar datos, marcar como
// ENTREGADO, o crear+marcar codigos que nunca pasaron por Recepcion.
// Nunca escribe nada durante el parseo/validacion — eso solo ocurre en
// ejecutarImportacion()/registrarImportLog(), y siempre despues de que
// el administrador confirma un resumen ya validado contra la BD real.
import ExcelJS from 'exceljs';
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { normalizarCodigo, canonicalizarSeparadores } from '@/lib/codigo';
import { registrarPago } from '@/lib/package-transitions';
import { registrarAuditoria } from '@/lib/auditoria';

export type FormatoImportacion = 'CSV' | 'XLSX' | 'TXT';

export type CampoSistema =
  | 'codigo'
  | 'monto'
  | 'personaRecoge'
  | 'cliente'
  | 'emprendimiento'
  | 'fecha'
  | 'hora'
  | 'fechaRecepcion'
  | 'observaciones'
  | 'descripcion';

export const CAMPOS_SISTEMA: Array<{ value: CampoSistema; label: string }> = [
  { value: 'codigo', label: 'Código' },
  { value: 'monto', label: 'Monto cobrado' },
  { value: 'personaRecoge', label: 'Persona que recogió' },
  { value: 'cliente', label: 'Cliente / remitente (quien deja)' },
  { value: 'emprendimiento', label: 'Emprendimiento' },
  { value: 'fecha', label: 'Fecha de entrega (YYYY-MM-DD)' },
  { value: 'hora', label: 'Hora de entrega (HH:MM)' },
  { value: 'fechaRecepcion', label: 'Fecha de recepción (YYYY-MM-DD)' },
  { value: 'observaciones', label: 'Observaciones' },
  { value: 'descripcion', label: 'Descripción del paquete' },
];

export interface FilaImportacion {
  numeroFila: number;
  codigo: string;
  fecha?: string; // YYYY-MM-DD — fecha de ENTREGA (ver confirmarImportacion/crearPaquetesFaltantes)
  hora?: string; // HH:MM — hora de ENTREGA
  // Fecha real de RECEPCION del paquete (distinta de "fecha"/"hora" de
  // arriba, que siempre fueron de entrega) — solo se usa para paquetes
  // genuinamente nuevos (crearPaquetesFaltantes), donde alimenta
  // Package.ingresoAt. Concepto nuevo, separado a proposito: no reutiliza
  // "fecha" para no cambiar el significado de una columna que
  // MARCAR_ENTREGADOS ya usa hace tiempo.
  fechaRecepcion?: string; // YYYY-MM-DD
  monto?: number;
  // Persona que RECOGE el paquete (Fase 2) — distinta de "cliente"
  // (quien lo DEJA). Se guarda como Package.destinatario.
  personaRecoge?: string;
  cliente?: string;
  emprendimiento?: string;
  observaciones?: string;
  descripcion?: string;
}

export type EstadoFila = 'valido' | 'duplicado' | 'invalido' | 'no_encontrado' | 'ya_entregado';

export interface FilaValidada extends FilaImportacion {
  estado: EstadoFila;
  motivo?: string;
  packageId?: string;
  codigoOficial?: string;
  // Fecha de recepcion ya resuelta para esta fila (YYYY-MM-DD), sin
  // importar si vino de la columna fechaRecepcion o de la fecha unica
  // elegida para todo el archivo — ver validarFilas(). Solo tiene sentido
  // para filas que terminan creando un paquete nuevo (no_encontrado), pero
  // se calcula para cualquier fila valida asi el preview siempre puede
  // mostrar "la fecha interpretada" tal como pide la especificacion.
  fechaRecepcionResuelta?: string;
}

export interface ResumenValidacion {
  detectados: number;
  validos: number;
  duplicados: number;
  invalidos: number;
  noEncontrados: number;
  filas: FilaValidada[];
}

// Encabezados con un unico significado razonable: se auto-mapean sin
// pedir confirmacion. Los que podrian significar mas de una cosa (ej.
// "nombre" o "cliente" — podrian ser quien DEJA el paquete o quien lo
// RECOGE) a proposito NO estan aqui: quedan sin mapear para que el
// mapeador visual se lo pregunte al administrador (ver
// detectarEncabezados() y el parametro "mapeo" de parseCSV/parseXLSX).
const COLUMNAS_INEQUIVOCAS: Record<string, CampoSistema> = {
  codigo: 'codigo',
  'código': 'codigo',
  code: 'codigo',
  'código paquete': 'codigo',
  'codigo paquete': 'codigo',
  'código del paquete': 'codigo',
  'codigo del paquete': 'codigo',

  monto: 'monto',
  'monto cobrado': 'monto',
  importe: 'monto',
  cobrado: 'monto',
  bs: 'monto',
  precio: 'monto',

  'persona que recogió': 'personaRecoge',
  'persona que recogio': 'personaRecoge',
  'quien recogió': 'personaRecoge',
  'quien recogio': 'personaRecoge',
  'quién recogió': 'personaRecoge',
  'quién recogio': 'personaRecoge',
  'recogió': 'personaRecoge',
  recogio: 'personaRecoge',
  destinatario: 'personaRecoge',

  emprendimiento: 'emprendimiento',
  fecha: 'fecha',
  hora: 'hora',
  // A proposito NO se incluye el simple "fecha" aqui: esa palabra sola
  // sigue significando fecha de ENTREGA (arriba), sin ambiguedad. El
  // administrador debe elegir explicitamente en el mapeador si su columna
  // es "fecha de recepción" — o usar el selector de fecha global de la
  // pantalla en vez de una columna.
  'fecha de recepción': 'fechaRecepcion',
  'fecha de recepcion': 'fechaRecepcion',
  'fecha recepción': 'fechaRecepcion',
  'fecha recepcion': 'fechaRecepcion',
  'fecha ingreso': 'fechaRecepcion',
  'fecha de ingreso': 'fechaRecepcion',
  observaciones: 'observaciones',
  'descripción': 'descripcion',
  descripcion: 'descripcion',
};

function normalizarEncabezado(s: string): string {
  return s.trim().toLowerCase();
}

/** Parser CSV simple: soporta campos entre comillas con comas adentro, suficiente para el uso real (nombres/observaciones cortas). */
function parseCSVLineas(texto: string): string[][] {
  const lineas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      lineas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    lineas.push(fila);
  }
  return lineas.filter((l) => l.some((c) => c.trim() !== ''));
}

function filasDesdeTabla(encabezados: string[], filas: string[][], mapeoExplicito?: Array<CampoSistema | null>): FilaImportacion[] {
  const mapaColumnas: Array<CampoSistema | null> = mapeoExplicito ?? encabezados.map((h) => COLUMNAS_INEQUIVOCAS[normalizarEncabezado(h)] ?? null);
  if (!mapaColumnas.includes('codigo')) {
    throw new Error('Selecciona qué columna del archivo corresponde al Código antes de continuar.');
  }

  return filas.map((celdas, idx) => {
    const fila: FilaImportacion = { numeroFila: idx + 2, codigo: '' }; // +2: fila 1 es encabezado, y es 1-indexado para el usuario
    mapaColumnas.forEach((campo, i) => {
      if (!campo) return;
      const valor = (celdas[i] ?? '').toString().trim();
      if (!valor) return;
      if (campo === 'monto') {
        const n = Number(valor.replace(',', '.'));
        if (Number.isFinite(n)) fila.monto = n;
      } else {
        (fila as unknown as Record<string, string>)[campo] = valor;
      }
    });
    return fila;
  });
}

export interface EncabezadoDetectado {
  /** Texto del encabezado tal como viene en el archivo. */
  columna: string;
  /** Mejor intento automático; null si es ambiguo o desconocido y requiere que el administrador lo asigne a mano. */
  sugerido: CampoSistema | null;
}

export interface DeteccionColumnas {
  encabezados: EncabezadoDetectado[];
  /** Cantidad de filas de datos (sin contar el encabezado), para mostrar de inmediato "N filas detectadas". */
  totalFilas: number;
}

/** Solo lee encabezados y cuenta filas para el mapeador visual — no valida ni escribe nada. */
export async function detectarEncabezados(formato: FormatoImportacion, buffer: Buffer): Promise<DeteccionColumnas> {
  if (formato === 'TXT') {
    const totalFilas = buffer
      .toString('utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    return { encabezados: [], totalFilas }; // TXT es una lista de codigos sin encabezados, no hay nada que mapear
  }

  let encabezadosRaw: string[];
  let totalFilas: number;
  if (formato === 'CSV') {
    const lineas = parseCSVLineas(buffer.toString('utf-8'));
    encabezadosRaw = lineas[0] ?? [];
    totalFilas = Math.max(0, lineas.length - 1);
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const hoja = workbook.worksheets[0];
    const primeraFila: string[] = [];
    hoja?.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
      primeraFila.push(cell.value === null || cell.value === undefined ? '' : String(cell.value));
    });
    encabezadosRaw = primeraFila;
    totalFilas = Math.max(0, (hoja?.rowCount ?? 1) - 1);
  }

  const encabezados = encabezadosRaw
    .map((c) => c.toString().trim())
    .filter(Boolean)
    .map((columna) => ({ columna, sugerido: COLUMNAS_INEQUIVOCAS[normalizarEncabezado(columna)] ?? null }));

  return { encabezados, totalFilas };
}

export function parseCSV(texto: string, mapeo?: Array<CampoSistema | null>): FilaImportacion[] {
  const lineas = parseCSVLineas(texto);
  if (lineas.length === 0) return [];
  const encabezados = lineas[0]!;
  return filasDesdeTabla(encabezados, lineas.slice(1), mapeo);
}

export function parseTXT(texto: string): FilaImportacion[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((codigo, idx) => ({ numeroFila: idx + 1, codigo }));
}

export async function parseXLSX(buffer: Buffer, mapeo?: Array<CampoSistema | null>): Promise<FilaImportacion[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const hoja = workbook.worksheets[0];
  if (!hoja) return [];

  const filas: string[][] = [];
  hoja.eachRow((row) => {
    const celdas: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      celdas.push(cell.value === null || cell.value === undefined ? '' : String(cell.value));
    });
    filas.push(celdas);
  });
  if (filas.length === 0) return [];
  const encabezados = filas[0]!;
  return filasDesdeTabla(encabezados, filas.slice(1), mapeo);
}

const CODIGO_VALIDO_RE = /^[A-Z]+[A-Z0-9-]*$/;

/**
 * Interpreta una fecha de recepcion escrita a mano en un archivo real:
 * acepta tanto el formato interno YYYY-MM-DD como DD/MM/AAAA o DD-MM-AAAA
 * (el formato mas comun en archivos de usuarios bolivianos, ver ejemplo
 * de la especificacion: "18/08/2026"). Devuelve YYYY-MM-DD o null si no
 * se pudo interpretar — nunca "adivina" ni normaliza silenciosamente una
 * fecha invalida (ej. "31/02/2026" se rechaza, no se convierte a marzo).
 */
function parseFechaRecepcionFlexible(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  let anio: number, mes: number, dia: number;
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const ddmmMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (isoMatch) {
    anio = Number(isoMatch[1]);
    mes = Number(isoMatch[2]);
    dia = Number(isoMatch[3]);
  } else if (ddmmMatch) {
    dia = Number(ddmmMatch[1]);
    mes = Number(ddmmMatch[2]);
    anio = Number(ddmmMatch[3]);
  } else {
    return null;
  }

  const fecha = new Date(anio, mes - 1, dia);
  // new Date() normaliza dias fuera de rango (ej. 31/02 -> 3 de marzo) en
  // vez de rechazarlos — comparar los componentes de vuelta es lo que
  // realmente detecta una fecha invalida.
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;

  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export interface OpcionesFechaRecepcion {
  modo: 'unica' | 'por_fila';
  // Requerida cuando modo === 'unica'; ignorada en modo 'por_fila'.
  fechaUnica?: string; // YYYY-MM-DD
}

/**
 * Valida el formato de cada fila, marca duplicados dentro del mismo
 * archivo, y verifica contra la base de datos real cuales codigos
 * existen. Nunca escribe nada — es de solo lectura. Usa
 * normalizarCodigo() tal cual (la misma funcion de Fase 1, sin
 * modificarla) para que un codigo con apostrofe en vez de guion se
 * reconozca igual que en Recepcion/Buscador/Entrega.
 */
export async function validarFilas(filas: FilaImportacion[], opcionesFecha?: OpcionesFechaRecepcion): Promise<ResumenValidacion> {
  const vistos = new Map<string, number>(); // codigoNormalizado -> primera fila donde aparecio
  const normalizados = filas.map((f) => normalizarCodigo(f.codigo));

  const codigosUnicos = Array.from(new Set(normalizados.filter(Boolean)));
  const existentes = codigosUnicos.length
    ? await prisma.package.findMany({
        where: { codigoNormalizado: { in: codigosUnicos } },
        select: { id: true, code: true, codigoNormalizado: true, status: true },
      })
    : [];
  const porCodigoNormalizado = new Map(existentes.map((p) => [p.codigoNormalizado, p]));

  const validadas: FilaValidada[] = filas.map((fila, i) => {
    const codigoNorm = normalizados[i]!;

    if (!fila.codigo || !CODIGO_VALIDO_RE.test(codigoNorm)) {
      return { ...fila, estado: 'invalido', motivo: 'Código con formato irreconocible.' };
    }

    const primeraApaericion = vistos.get(codigoNorm);
    if (primeraApaericion !== undefined) {
      return { ...fila, estado: 'duplicado', motivo: `Repetido de la fila ${primeraApaericion}.` };
    }
    vistos.set(codigoNorm, fila.numeroFila);

    // Fecha de recepcion (concepto nuevo, distinto de fecha/hora de
    // entrega): en modo "unica" se aplica la misma a todas las filas sin
    // mirar ninguna columna; en modo "por_fila" se interpreta la columna
    // de esta fila puntual, y si esta presente pero no se pudo interpretar,
    // la fila se rechaza explicitamente (a diferencia de fecha/hora de
    // entrega, que ignoran en silencio una fecha invalida — aqui el
    // usuario pidio explicitamente que se valide).
    let fechaRecepcionResuelta: string | undefined;
    if (opcionesFecha?.modo === 'unica' && opcionesFecha.fechaUnica) {
      fechaRecepcionResuelta = opcionesFecha.fechaUnica;
    } else if (opcionesFecha?.modo === 'por_fila' && fila.fechaRecepcion) {
      const interpretada = parseFechaRecepcionFlexible(fila.fechaRecepcion);
      if (!interpretada) {
        return { ...fila, estado: 'invalido', motivo: `Fecha de recepción inválida: "${fila.fechaRecepcion}" (se esperaba DD/MM/AAAA).` };
      }
      fechaRecepcionResuelta = interpretada;
    }

    const existente = porCodigoNormalizado.get(codigoNorm);
    if (!existente) {
      return { ...fila, estado: 'no_encontrado', motivo: 'No existe ningún paquete con este código en el sistema.', fechaRecepcionResuelta };
    }
    if (existente.status === 'DENEGADO') {
      return { ...fila, estado: 'invalido', motivo: 'Este paquete está DENEGADO; no puede modificarse por importación.', packageId: existente.id, codigoOficial: existente.code };
    }
    if (existente.status === 'ENTREGADO') {
      return { ...fila, estado: 'ya_entregado', motivo: 'Ya estaba marcado como entregado.', packageId: existente.id, codigoOficial: existente.code };
    }
    return { ...fila, estado: 'valido', packageId: existente.id, codigoOficial: existente.code };
  });

  return {
    detectados: filas.length,
    validos: validadas.filter((f) => f.estado === 'valido' || f.estado === 'ya_entregado').length,
    duplicados: validadas.filter((f) => f.estado === 'duplicado').length,
    invalidos: validadas.filter((f) => f.estado === 'invalido').length,
    noEncontrados: validadas.filter((f) => f.estado === 'no_encontrado').length,
    filas: validadas,
  };
}

function parseFechaHora(fecha?: string, hora?: string): Date | null {
  if (!fecha) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
  if (!iso) return null;
  const horaValida = hora && /^\d{1,2}:\d{2}$/.test(hora) ? hora : '00:00';
  const d = new Date(`${iso}T${horaValida.padStart(5, '0')}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Procesamiento en bloques (no 10.000 filas de una vez ni todas en
// paralelo sin control): cada fila dentro de un bloque es atomica en si
// misma (su propia transaccion/registrarPago), y se resuelve con
// Promise.allSettled para que una fila con error nunca tumbe a las demas
// del mismo bloque. Los bloques solo limitan cuantas operaciones estan
// en vuelo al mismo tiempo — la seguridad de escritura concurrente ya la
// da connection_limit=1 + WAL (ver src/lib/prisma.ts, Fase 1), la misma
// proteccion ya validada con escaneos realmente simultaneos.
const TAMANO_BLOQUE = 250;

function enBloques<T>(items: T[], tamano: number): T[][] {
  const bloques: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) bloques.push(items.slice(i, i + tamano));
  return bloques;
}

export interface ResultadoConfirmacion {
  marcadosEntregado: number;
  yaEntregados: number;
  errores: Array<{ fila: number; motivo: string }>;
}

/** Marca como ENTREGADO cada fila "valido" de una validacion ya hecha. Nunca crea paquetes que no existen (ver crearPaquetesFaltantes). */
export async function confirmarImportacion(filas: FilaValidada[], userId: string): Promise<ResultadoConfirmacion> {
  const aProcesar = filas.filter((f) => f.estado === 'valido' && f.packageId);
  let marcadosEntregado = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];

  for (const bloque of enBloques(aProcesar, TAMANO_BLOQUE)) {
    const resultados = await Promise.allSettled(
      bloque.map(async (fila) => {
        const pkg = await prisma.package.findUnique({ where: { id: fila.packageId! } });
        if (!pkg || pkg.status === 'ENTREGADO' || pkg.status === 'DENEGADO') return false; // cambio de estado mientras tanto: se salta, no se rompe el resto

        const entregaAt = parseFechaHora(fila.fecha, fila.hora) ?? new Date();

        const actualizado = await prisma.$transaction(async (tx) => {
          const res = await tx.package.updateMany({
            where: { id: pkg.id, status: pkg.status },
            data: {
              status: 'ENTREGADO',
              entregaAt,
              // Origen estructurado (Fase 2): nunca debe parecer una
              // entrega hecha con el lector.
              origenEntrega: 'IMPORTACION',
              ...(fila.personaRecoge ? { destinatario: fila.personaRecoge } : {}),
            },
          });
          if (res.count === 0) return null;
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa' } });
          return tx.package.findUniqueOrThrow({ where: { id: pkg.id } });
        }, TRANSACTION_OPTS);
        if (!actualizado) return false;

        if (fila.monto && fila.monto > 0) {
          await registrarPago(actualizado, 'COBRO_ENTREGA', fila.monto, userId, 'Importación administrativa');
        }
        return true;
      })
    );

    resultados.forEach((r, i) => {
      const fila = bloque[i]!;
      if (r.status === 'fulfilled') {
        if (r.value) marcadosEntregado++;
      } else {
        errores.push({ fila: fila.numeroFila, motivo: r.reason instanceof Error ? r.reason.message : 'Error desconocido' });
      }
    });
  }

  return { marcadosEntregado, yaEntregados: filas.filter((f) => f.estado === 'ya_entregado').length, errores };
}

export interface ResultadoCreacionFaltantes {
  creados: number;
  errores: Array<{ fila: number; motivo: string }>;
  // Aditivo (Fase 3): packageId/code del paquete recien creado por cada
  // fila exitosa, para que ejecutarImportacion() pueda completar
  // ImportRow.packageId/codigoOficial tambien en este caso — antes
  // quedaban null para filas "creado" (solo se llenaban para filas que
  // ya existian), lo que impedia mostrar el lote de origen en
  // Entrega/Buscador para paquetes creados por importacion. No cambia
  // ningun comportamiento de creacion en si, solo completa el dato.
  codigosCreados: Array<{ fila: number; packageId: string; code: string }>;
}

/** Accion explicita, solo para ADMIN: crea como paquetes ENTREGADO los codigos "no encontrados". */
export async function crearPaquetesFaltantes(filas: FilaValidada[], userId: string, branchId: string): Promise<ResultadoCreacionFaltantes> {
  const faltantes = filas.filter((f) => f.estado === 'no_encontrado');
  let creados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];
  const codigosCreados: Array<{ fila: number; packageId: string; code: string }> = [];

  for (const bloque of enBloques(faltantes, TAMANO_BLOQUE)) {
    const resultados = await Promise.allSettled(
      bloque.map(async (fila) => {
        // canonicalizarSeparadores() antes de guardar: si la celda del
        // Excel trae "M19A/29" (u otro separador equivalente, ver
        // src/lib/codigo.ts), el paquete debe quedar creado como
        // "M19A-29" — el formato canonico — nunca con el separador tal
        // cual vino del archivo.
        const code = canonicalizarSeparadores(fila.codigo.trim()).toUpperCase();
        const codigoNormalizado = normalizarCodigo(code);
        const inicial = code.match(/^[A-Z]+/)?.[0];
        if (!inicial) throw new Error('Código sin inicial reconocible.');

        // Si la serie nunca se registro (ej. un lote historico que jamas
        // paso por "Codigos personalizados"), se crea aqui con el mismo
        // patron de upsert que ya usa generarCodigosPersonalizados (ver
        // src/lib/etiquetas.ts) — asi la importacion no queda bloqueada
        // por una serie que nadie configuro a mano todavia.
        const serie = await prisma.packageSeries.upsert({
          where: { inicial },
          update: {},
          create: { inicial, descripcion: `Serie ${inicial} (creada por importación)`, correlativo: 0 },
        });

        const entregaAt = parseFechaHora(fila.fecha, fila.hora) ?? new Date();
        // Fecha de recepcion (concepto nuevo, ver validarFilas): si la
        // fila trae una resuelta (fecha unica del archivo, o interpretada
        // de su propia columna), esa es la fecha REAL de ingreso — nunca
        // mas forzada a ser igual a la fecha de entrega. Si no se
        // configuro ninguna, se mantiene el comportamiento de siempre
        // (ingresoAt = entregaAt).
        const ingresoAt = fila.fechaRecepcionResuelta ? new Date(`${fila.fechaRecepcionResuelta}T00:00:00`) : entregaAt;

        let cliente = null;
        if (fila.cliente || fila.emprendimiento) {
          cliente = await prisma.cliente.create({ data: { nombre: fila.cliente || null, emprendimiento: fila.emprendimiento || null } });
        }

        const nuevo = await prisma.$transaction(async (tx) => {
          const pkg = await tx.package.create({
            data: {
              code,
              codigoNormalizado,
              inicial,
              branchId,
              status: 'ENTREGADO',
              ingresoAt,
              entregaAt,
              origenEntrega: 'IMPORTACION',
              tarifaBaseOverride: serie.tarifaBaseOverride,
              registradoPorId: userId,
              clienteId: cliente?.id ?? null,
              destinatario: fila.personaRecoge || null,
              observaciones: fila.observaciones || '',
              descripcion: fila.descripcion || null,
            },
          });
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'EN_PAQUETERIA', fecha: ingresoAt, userId, nota: 'Importación administrativa (registro faltante)' } });
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa (registro faltante)' } });
          return pkg;
        }, TRANSACTION_OPTS);

        if (fila.monto && fila.monto > 0) {
          await registrarPago(nuevo, 'COBRO_ENTREGA', fila.monto, userId, 'Importación administrativa (registro faltante)');
        }
        return { packageId: nuevo.id, code: nuevo.code };
      })
    );

    resultados.forEach((r, i) => {
      const fila = bloque[i]!;
      if (r.status === 'fulfilled') {
        creados++;
        codigosCreados.push({ fila: fila.numeroFila, packageId: r.value.packageId, code: r.value.code });
      } else {
        errores.push({ fila: fila.numeroFila, motivo: r.reason instanceof Error ? r.reason.message : 'Error desconocido' });
      }
    });
  }

  return { creados, errores, codigosCreados };
}

export interface ResultadoSoloDatos {
  actualizados: number;
  errores: Array<{ fila: number; motivo: string }>;
}

/**
 * Modo "Solo registrar datos": actualiza destinatario/monto en paquetes
 * que YA EXISTEN (cualquier estado salvo DENEGADO), sin tocar su status
 * — nunca marca ENTREGADO ni crea faltantes. El monto, si viene, entra
 * igual al ledger financiero (como AJUSTE, no como cobro de entrega,
 * porque el paquete puede seguir En Paquetería).
 */
export async function registrarSoloDatos(filas: FilaValidada[], userId: string): Promise<ResultadoSoloDatos> {
  const aProcesar = filas.filter((f) => (f.estado === 'valido' || f.estado === 'ya_entregado') && f.packageId);
  let actualizados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];

  for (const bloque of enBloques(aProcesar, TAMANO_BLOQUE)) {
    const resultados = await Promise.allSettled(
      bloque.map(async (fila) => {
        const pkg = await prisma.package.findUnique({ where: { id: fila.packageId! } });
        if (!pkg) throw new Error('El paquete ya no existe.');

        if (fila.personaRecoge) {
          await prisma.package.update({ where: { id: pkg.id }, data: { destinatario: fila.personaRecoge } });
        }
        if (fila.monto && fila.monto > 0) {
          await registrarPago(pkg, 'AJUSTE', fila.monto, userId, 'Importación administrativa (solo datos)');
        }
      })
    );
    resultados.forEach((r, i) => {
      const fila = bloque[i]!;
      if (r.status === 'fulfilled') actualizados++;
      else errores.push({ fila: fila.numeroFila, motivo: r.reason instanceof Error ? r.reason.message : 'Error desconocido' });
    });
  }
  return { actualizados, errores };
}

export type TipoImportacion = 'SOLO_REGISTRAR' | 'MARCAR_ENTREGADOS' | 'CREAR_Y_ENTREGAR';

export interface FilaResultado {
  numeroFila: number;
  codigo: string;
  codigoOficial: string | null;
  packageId: string | null;
  monto: number | null;
  persona: string | null;
  estado: string; // VALIDO | DUPLICADO | INVALIDO | NO_ENCONTRADO | YA_ENTREGADO | CREADO | ENTREGADO | SOLO_DATOS | ERROR
  motivo: string | null;
}

export interface ResultadoImportacion {
  tipo: TipoImportacion;
  entregados: number;
  creados: number;
  actualizados: number;
  conError: number;
  filas: FilaResultado[];
}

/**
 * Orquesta el modo elegido por el administrador sobre un resumen ya
 * validado, y arma el detalle fila-por-fila (incluyendo las filas que NO
 * se tocaron: invalidas/duplicadas/no encontradas cuando el modo no las
 * crea) para que registrarImportLog() lo persista completo en ImportRow
 * — necesario para que la pantalla de detalle de lote pueda filtrar y
 * buscar sin volver a leer el archivo original.
 */
export async function ejecutarImportacion(resumen: ResumenValidacion, tipo: TipoImportacion, userId: string, branchId: string): Promise<ResultadoImportacion> {
  const porFila = new Map<number, FilaResultado>();
  resumen.filas.forEach((f) => {
    const estadoInicial =
      f.estado === 'invalido' ? 'INVALIDO' : f.estado === 'duplicado' ? 'DUPLICADO' : f.estado === 'no_encontrado' ? 'NO_ENCONTRADO' : f.estado === 'ya_entregado' ? 'YA_ENTREGADO' : 'VALIDO';
    porFila.set(f.numeroFila, {
      numeroFila: f.numeroFila,
      codigo: f.codigo,
      codigoOficial: f.codigoOficial ?? null,
      packageId: f.packageId ?? null,
      monto: f.monto ?? null,
      persona: f.personaRecoge ?? null,
      estado: estadoInicial,
      motivo: f.motivo ?? null,
    });
  });

  let entregados = 0;
  let creados = 0;
  let actualizados = 0;

  if (tipo === 'SOLO_REGISTRAR') {
    const r = await registrarSoloDatos(resumen.filas, userId);
    actualizados = r.actualizados;
    resumen.filas
      .filter((f) => (f.estado === 'valido' || f.estado === 'ya_entregado') && f.packageId)
      .forEach((f) => {
        const err = r.errores.find((e) => e.fila === f.numeroFila);
        const row = porFila.get(f.numeroFila)!;
        row.estado = err ? 'ERROR' : 'SOLO_DATOS';
        if (err) row.motivo = err.motivo;
      });
  } else {
    const r = await confirmarImportacion(resumen.filas, userId);
    entregados += r.marcadosEntregado;
    resumen.filas
      .filter((f) => f.estado === 'valido' && f.packageId)
      .forEach((f) => {
        const err = r.errores.find((e) => e.fila === f.numeroFila);
        const row = porFila.get(f.numeroFila)!;
        row.estado = err ? 'ERROR' : 'ENTREGADO';
        if (err) row.motivo = err.motivo;
      });

    if (tipo === 'CREAR_Y_ENTREGAR') {
      const rf = await crearPaquetesFaltantes(resumen.filas, userId, branchId);
      creados = rf.creados;
      entregados += rf.creados; // un registro creado por importacion queda ENTREGADO directamente
      resumen.filas
        .filter((f) => f.estado === 'no_encontrado')
        .forEach((f) => {
          const err = rf.errores.find((e) => e.fila === f.numeroFila);
          const row = porFila.get(f.numeroFila)!;
          row.estado = err ? 'ERROR' : 'CREADO';
          if (err) row.motivo = err.motivo;
        });
      // Completa packageId/codigoOficial para las filas recien creadas
      // (antes quedaban null en ImportRow — ver comentario en
      // ResultadoCreacionFaltantes.codigosCreados).
      rf.codigosCreados.forEach((c) => {
        const row = porFila.get(c.fila);
        if (row) {
          row.packageId = c.packageId;
          row.codigoOficial = c.code;
        }
      });
    }
  }

  const filas = Array.from(porFila.values()).sort((a, b) => a.numeroFila - b.numeroFila);
  const conError = filas.filter((f) => f.estado === 'ERROR').length;

  return { tipo, entregados, creados, actualizados, conError, filas };
}

export async function registrarImportLog(params: {
  nombreArchivo: string;
  nombreLote?: string;
  formato: FormatoImportacion;
  resumen: ResumenValidacion;
  resultado: ResultadoImportacion;
  userId: string;
}): Promise<string> {
  const log = await prisma.importLog.create({
    data: {
      nombreArchivo: params.nombreArchivo,
      nombreLote: params.nombreLote || null,
      formato: params.formato,
      tipoImportacion: params.resultado.tipo,
      detectados: params.resumen.detectados,
      validos: params.resumen.validos,
      duplicados: params.resumen.duplicados,
      invalidos: params.resumen.invalidos,
      marcadosEntregado: params.resultado.entregados,
      noEncontrados: params.resumen.noEncontrados,
      creadosFaltantes: params.resultado.creados,
      detalleErrores: params.resultado.conError
        ? JSON.stringify(params.resultado.filas.filter((f) => f.estado === 'ERROR').map((f) => ({ fila: f.numeroFila, motivo: f.motivo })))
        : null,
      userId: params.userId,
    },
  });

  if (params.resultado.filas.length > 0) {
    await prisma.importRow.createMany({
      data: params.resultado.filas.map((f) => ({
        importLogId: log.id,
        numeroFila: f.numeroFila,
        codigo: f.codigo,
        codigoOficial: f.codigoOficial,
        packageId: f.packageId,
        monto: f.monto,
        persona: f.persona,
        estado: f.estado,
        motivo: f.motivo,
      })),
    });
  }

  await registrarAuditoria({
    userId: params.userId,
    accion: 'IMPORTACION_MASIVA',
    modulo: 'importacion',
    valorNuevo: {
      archivo: params.nombreArchivo,
      nombreLote: params.nombreLote || undefined,
      tipo: params.resultado.tipo,
      detectados: params.resumen.detectados,
      validos: params.resumen.validos,
      duplicados: params.resumen.duplicados,
      invalidos: params.resumen.invalidos,
      entregados: params.resultado.entregados,
      creados: params.resultado.creados,
      actualizados: params.resultado.actualizados,
    },
  });

  return log.id;
}

/**
 * Nombre del lote de importacion (o del archivo si el lote no tiene
 * nombre) para cada packageId dado, en una sola consulta batched — usada
 * por Entrega y Buscador (Fase 3) para mostrar "Importación
 * administrativa · {lote}" junto al paquete, sin una consulta extra por
 * fila. Nunca se llama desde toPackageDetailDTOList()/Dashboard/Reportes
 * a proposito: ese costo solo debe pagarse donde realmente se muestra.
 */
export async function getLotesPorPackageId(packageIds: string[]): Promise<Record<string, string>> {
  if (packageIds.length === 0) return {};
  const filas = await prisma.importRow.findMany({
    where: { packageId: { in: packageIds }, estado: { in: ['ENTREGADO', 'CREADO', 'SOLO_DATOS'] } },
    select: { packageId: true, importLog: { select: { nombreLote: true, nombreArchivo: true } } },
  });
  const mapa: Record<string, string> = {};
  for (const fila of filas) {
    if (fila.packageId && !mapa[fila.packageId]) {
      mapa[fila.packageId] = fila.importLog.nombreLote || fila.importLog.nombreArchivo;
    }
  }
  return mapa;
}
