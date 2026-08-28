// src/lib/importacion.ts
// Importacion masiva de codigos (Fase 2): registrar datos, marcar como
// ENTREGADO, o crear+marcar codigos que nunca pasaron por Recepcion.
// Nunca escribe nada durante el parseo/validacion — eso solo ocurre en
// ejecutarImportacion()/registrarImportLog(), y siempre despues de que
// el administrador confirma un resumen ya validado contra la BD real.
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { normalizarCodigo, canonicalizarSeparadores } from '@/lib/codigo';
import { registrarPago, aplicarPagoEnTx } from '@/lib/package-transitions';
import { registrarAuditoria } from '@/lib/auditoria';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { fechaReferencia } from '@/lib/package-detail';

export type FormatoImportacion = 'CSV' | 'XLSX' | 'TXT';

export type CampoSistema =
  | 'codigo'
  | 'monto'
  | 'personaRecoge'
  | 'celular'
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
  { value: 'celular', label: 'Celular de quien recogió' },
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
  // Celular de quien recoge — se guarda como Package.destinatarioTelefono.
  // Antes la importacion no tenia NINGUN campo para esto (bug real
  // confirmado): el archivo podia traer el celular en una columna, pero
  // no habia forma de mapearla — se perdia en silencio.
  celular?: string;
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
  // --- Seguridad financiera (import de ENTREGAS HISTORICAS) ---
  // Cuanto tiene pagado HOY el paquete que ya existe (valido/ya_entregado),
  // para que el preview pueda mostrar exactamente por que se va a tocar o
  // no Finanzas — nunca queda implicito. undefined para no_encontrado
  // (todavia no existe ningun Package).
  montoPagadoExistente?: number;
  // true cuando el paquete YA existe, YA tiene un pago (montoPagadoExistente>0),
  // y el archivo trae ademas un monto explicito para esa fila: ese monto
  // se ignora siempre (ver REGLA 5 — "si ya tiene pago, la importacion no
  // debe tocar finanzas", sin excepcion), y esto lo deja visible en vez de
  // fallar en silencio.
  avisoFinanciero?: string;
  // true cuando el paquete YA existe, NO tiene ningun pago registrado
  // (montoPagadoExistente === 0), y el archivo NO trae un monto explicito
  // para esa fila: nunca se asume Bs2 (u otra tarifa) automaticamente en
  // este caso (ver REGLA 6) — la fila se procesa igual (se puede marcar
  // entregado / completar nombre-celular) pero SIN generar ningun Pago, y
  // queda marcada aqui para que el administrador la revise manualmente
  // despues (ej. con "Corregir cobro" en Finanzas) si corresponde cobrar.
  requiereRevisionPago?: boolean;
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

  // Celular de quien recoge. A proposito NO se incluye el simple
  // "numero"/"número" (podria ser un numero de pedido, de casillero,
  // etc. — igual de ambiguo que "nombre"/"cliente" arriba); solo frases
  // que ya dejan claro que se trata de un telefono.
  celular: 'celular',
  telefono: 'celular',
  movil: 'celular',
  whatsapp: 'celular',
  'telefono celular': 'celular',
  'numero celular': 'celular',
  'nro celular': 'celular',
  'n celular': 'celular',
  'celular de contacto': 'celular',
  'telefono de contacto': 'celular',

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

/**
 * Antes solo hacia trim+lowercase — "Teléfono", "N° Celular" o "Nro.
 * Celular" nunca coincidian con ninguna clave del diccionario de abajo
 * (bug real confirmado: la columna de celular jamas se detectaba
 * automaticamente). Ahora tambien quita acentos, puntos/grados/guiones y
 * colapsa espacios, para que las variantes razonables de un mismo
 * encabezado normalicen al mismo texto.
 */
const DIACRITICOS_RE = new RegExp('[̀-ͯ]', 'g');

function normalizarEncabezado(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICOS_RE, '') // acentos/diacriticos
    .trim()
    .toLowerCase()
    .replace(/[°.\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
/**
 * Edicion puntual de una fila hecha por el administrador en la
 * previsualizacion (antes de confirmar) — código, nombre de quien
 * recoge, celular o monto. Se aplica ANTES de validarFilas() (nunca
 * despues): asi una edicion de código pasa por exactamente la misma
 * validacion real contra la base de datos que si el archivo hubiera
 * traido ese valor desde el principio — el servidor sigue siendo quien
 * decide si el resultado es valido/duplicado/etc, nunca confia en un
 * resumen ya calculado que vuelva del cliente (ver comentario al inicio
 * de src/app/api/importacion/route.ts).
 */
export interface EdicionFila {
  numeroFila: number;
  codigo?: string;
  monto?: number;
  personaRecoge?: string;
  celular?: string;
}

export function aplicarEdicionesFilas(filas: FilaImportacion[], ediciones?: EdicionFila[]): FilaImportacion[] {
  if (!ediciones || ediciones.length === 0) return filas;
  const porFila = new Map(ediciones.map((e) => [e.numeroFila, e]));
  return filas.map((fila) => {
    const edicion = porFila.get(fila.numeroFila);
    if (!edicion) return fila;
    return {
      ...fila,
      ...(edicion.codigo !== undefined ? { codigo: edicion.codigo } : {}),
      ...(edicion.monto !== undefined ? { monto: edicion.monto } : {}),
      ...(edicion.personaRecoge !== undefined ? { personaRecoge: edicion.personaRecoge } : {}),
      ...(edicion.celular !== undefined ? { celular: edicion.celular } : {}),
    };
  });
}

/**
 * Quita del conjunto a procesar las filas que el administrador eliminó en
 * la previsualización (numeroFila, 1-indexado igual que en el resto del
 * módulo) — ANTES de validarFilas(), igual criterio que
 * aplicarEdicionesFilas(): una fila eliminada nunca debe llegar a
 * validarFilas/ejecutarImportacion/registrarImportLog, así que no genera
 * ningún ImportRow, no cuenta como duplicado/inválido/lo que sea, no
 * puede crear Package/Pago/PackageHistory y no afecta Finanzas ni
 * estadísticas — es exactamente como si esa fila nunca hubiera estado en
 * el archivo. El frontend ya la retira de lo que muestra, pero esta
 * función es la que hace que el servidor (no el cliente) sea quien
 * realmente decide qué se procesa (ver comentario al inicio de
 * src/app/api/importacion/route.ts).
 */
export function aplicarExclusionesFilas(filas: FilaImportacion[], exclusiones?: number[]): FilaImportacion[] {
  if (!exclusiones || exclusiones.length === 0) return filas;
  const excluidas = new Set(exclusiones);
  return filas.filter((f) => !excluidas.has(f.numeroFila));
}

/**
 * @param montoDefault Tarifa a sugerir SOLO para filas que van a CREAR un
 * paquete nuevo (no_encontrado) cuando el archivo no trae un monto para
 * esa fila puntual — normalmente company.tarifaBase (hoy Bs 2,
 * configurable en Configuración → Tarifas). Nunca se aplica a filas de
 * paquetes que YA EXISTEN (valido/ya_entregado): antes esta funcion
 * rellenaba "fila.monto" con este default para TODAS las filas por igual,
 * lo que significaba que un archivo sin columna de monto (ej. solo
 * codigo+nombre) terminaba generando un cobro de Bs2 en CUALQUIER paquete
 * ya existente que no tuviera pago — un cobro inventado, exactamente lo
 * que la especificacion de importacion de entregas historicas prohibe
 * (REGLA 6: "jamas inventes un movimiento financiero unicamente porque
 * falta un Pago"). Ahora fila.monto nunca se muta aqui: sigue significando
 * "lo que el archivo/la edicion trajo explicitamente", y ese significado
 * es justamente lo que decide si un paquete existente se cobra o no (ver
 * mas abajo) — la tarifa por defecto solo se aplica, mas adelante, dentro
 * de crearPaquetesFaltantes()/crearPaquetesEnDeposito(), y unicamente
 * para paquetes genuinamente nuevos.
 */
export async function validarFilas(filas: FilaImportacion[], opcionesFecha?: OpcionesFechaRecepcion, montoDefault?: number): Promise<ResumenValidacion> {
  void montoDefault; // ver comentario: ya no se aplica aqui, solo en la creacion de paquetes nuevos (mismo parametro, uso reubicado).
  const vistos = new Map<string, number>(); // codigoNormalizado -> primera fila donde aparecio
  const normalizados = filas.map((f) => normalizarCodigo(f.codigo));

  const codigosUnicos = Array.from(new Set(normalizados.filter(Boolean)));
  const existentes = codigosUnicos.length
    ? await prisma.package.findMany({
        where: { codigoNormalizado: { in: codigosUnicos } },
        select: { id: true, code: true, codigoNormalizado: true, status: true, montoPagado: true },
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

    // El paquete ya existe (valido o ya_entregado): decide aqui, de una
    // vez y de forma explicita, que va a pasar con Finanzas — nunca lo
    // decide el codigo que ejecuta el cobro mas adelante en silencio (ver
    // REGLA 1/5/6 de la especificacion de importacion historica).
    let avisoFinanciero: string | undefined;
    let requiereRevisionPago = false;
    if (existente.montoPagado > 0) {
      // Ya tiene un pago real: la importacion JAMAS debe tocar Finanzas
      // para este paquete, sin excepcion — ni para agregar, ni para
      // reemplazar, sin importar que traiga el archivo.
      if (fila.monto !== undefined) {
        avisoFinanciero = `Este paquete ya tiene un pago registrado (Bs${existente.montoPagado}); el monto del archivo (Bs${fila.monto}) se ignorará — no se tocará Finanzas.`;
      }
    } else if (fila.monto === undefined) {
      // No tiene ningun pago Y el archivo no trae un monto explicito para
      // esta fila puntual: nunca se asume la tarifa base automaticamente
      // aqui (eso es exactamente "inventar un cobro"). Se marca para
      // revision manual; el resto de la fila (nombre/celular/estado) se
      // sigue procesando con normalidad.
      requiereRevisionPago = true;
    }

    const base = { ...fila, packageId: existente.id, codigoOficial: existente.code, montoPagadoExistente: existente.montoPagado, avisoFinanciero, requiereRevisionPago };
    if (existente.status === 'ENTREGADO') {
      return { ...base, estado: 'ya_entregado', motivo: 'Ya estaba marcado como entregado.' };
    }
    return { ...base, estado: 'valido' };
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
              ...(fila.celular ? { destinatarioTelefono: fila.celular } : {}),
            },
          });
          if (res.count === 0) return null;
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa' } });
          return tx.package.findUniqueOrThrow({ where: { id: pkg.id } });
        }, TRANSACTION_OPTS);
        if (!actualizado) return false;

        // Seguridad financiera (REGLA 5/6): "pkg" se releyo de la BD justo
        // arriba, asi que "pkg.montoPagado" es el valor real al momento de
        // procesar esta fila (no el de la previsualizacion, que pudo haber
        // quedado desactualizado). Si el paquete YA tenia algun pago
        // (ej. un anticipo cargado en Recepcion), la importacion NUNCA
        // agrega otro movimiento — evita duplicar/inflar un cobro sobre un
        // paquete que ya traia su propio dinero real. Solo se cobra cuando
        // no habia ningun pago Y el archivo trajo un monto EXPLICITO para
        // esta fila (fila.monto !== undefined) — nunca una tarifa asumida
        // (ver validarFilas(): esta funcion ya no rellena fila.monto con
        // ningun valor por defecto).
        if (pkg.montoPagado <= 0 && fila.monto !== undefined && fila.monto > 0) {
          // "entregaAt" (no "ahora"): si el archivo trae fecha, el cobro
          // debe quedar contabilizado en Finanzas ese dia — nunca hoy (ver
          // especificacion, "Importacion con fechas").
          await registrarPago(actualizado, 'COBRO_ENTREGA', fila.monto, userId, 'Importación administrativa', entregaAt);
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

/**
 * Accion explicita, solo para ADMIN: crea como paquetes ENTREGADO los
 * codigos "no encontrados" — paquete nuevo, entregado historicamente,
 * segun REGLA 3/4 de la especificacion de importacion historica.
 *
 * @param montoDefault Tarifa a cobrar cuando la fila no trae un monto
 * explicito (normalmente company.tarifaBase) — SOLO se aplica aqui,
 * nunca a paquetes que ya existian (ver comentario de validarFilas()).
 * Una entrega historica nueva SIGUE SIENDO UNA ENTREGA: por defecto se
 * cobra la tarifa vigente, igual que cualquier otra entrega del sistema.
 */
export async function crearPaquetesFaltantes(filas: FilaValidada[], userId: string, branchId: string, montoDefault: number): Promise<ResultadoCreacionFaltantes> {
  const faltantes = filas.filter((f) => f.estado === 'no_encontrado');
  let creados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];
  const codigosCreados: Array<{ fila: number; packageId: string; code: string }> = [];
  // Cargados una sola vez para todo el lote (no cambian entre filas de la
  // misma corrida) — evita una consulta de configuracion/feriados por
  // fila, y es lo que aplicarPagoEnTx() necesita para calcular el costo
  // vigente de cada paquete nuevo dentro de su propia transaccion.
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);

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

        // Monto a cobrar: explicito del archivo/edicion si vino, si no la
        // tarifa por defecto — nunca undefined para un paquete NUEVO (ver
        // REGLA 4: una entrega historica nueva siempre debe impactar
        // Finanzas, con su fecha historica).
        const montoAplicado = fila.monto ?? montoDefault;

        // TODO atomico en UNA sola transaccion (package.create + 2×
        // packageHistory + pago): antes el pago se registraba con una
        // llamada a registrarPago() DESPUES de que esta transaccion ya
        // habia confirmado (commit) — si esa segunda llamada fallaba por
        // cualquier motivo, quedaba un paquete ENTREGADO+Bs0+SIN Pago,
        // exactamente el patron de bug ya confirmado en produccion para
        // entregaExcepcional() (ver ese comentario en
        // src/lib/package-transitions.ts) y ahora corregido aqui de la
        // misma forma: si algo falla, ROLLBACK completo, no queda ningun
        // registro parcial.
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
              destinatarioTelefono: fila.celular || null,
              observaciones: fila.observaciones || '',
              descripcion: fila.descripcion || null,
            },
          });
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'EN_PAQUETERIA', fecha: ingresoAt, userId, nota: 'Importación administrativa (registro faltante)' } });
          await tx.packageHistory.create({ data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa (registro faltante)' } });
          if (montoAplicado > 0) {
            const costoActual = calcularCosto(
              pkg.ingresoAt,
              fechaReferencia(pkg),
              { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
              feriados,
              pkg.tarifaBaseOverride,
              pkg.diasIncluidosOverride
            ).total;
            // "entregaAt" (no "ahora"): si el archivo trae fecha, el cobro
            // debe quedar contabilizado en Finanzas ese dia — nunca hoy
            // (ver especificacion, "Importacion con fechas").
            await aplicarPagoEnTx(tx, pkg.id, 0, montoAplicado, costoActual, 'COBRO_ENTREGA', userId, 'Importación administrativa (registro faltante)', entregaAt);
          }
          return pkg;
        }, TRANSACTION_OPTS);

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

/**
 * Importación de DEPÓSITO (REGLA 11-13 de la especificación): crea como
 * paquetes EN_DEPOSITO los códigos "no encontrados" de la lista, usando la
 * fecha de recepción histórica exacta que trae el archivo — nunca la de
 * hoy. A diferencia de crearPaquetesFaltantes():
 *
 * - El paquete NO queda entregado: status EN_DEPOSITO, entregaAt=null.
 * - depositoAt = la misma fecha de ingreso (llegó directo a depósito, no
 *   pasó primero por "En Paquetería" con un envío a depósito posterior).
 * - NUNCA se crea ningún Pago (ni siquiera Bs0): un paquete en depósito
 *   todavía no fue cobrado, no tiene sentido registrar un movimiento de
 *   dinero al importarlo (ver REGLA 11: "NO deben crear un Pago de
 *   entrega"). El costo se sigue calculando en vivo, como cualquier otro
 *   paquete en depósito (calcularCosto() con ingresoAt real vs. la fecha
 *   actual, vía fechaReferencia() — REGLA 13, "depósito dinámico": esto ya
 *   funciona automaticamente para TODO el sistema en cuanto ingresoAt
 *   queda bien puesto, sin ninguna logica nueva de calculo).
 * - La fecha de recepción es OBLIGATORIA aquí (a diferencia de
 *   crearPaquetesFaltantes, donde es opcional): sin ella no hay forma de
 *   calcular cuántos días lleva en depósito. Una fila sin fecha resuelta
 *   queda como error de esa fila (visible en el resultado final), nunca
 *   se asume "hoy" en silencio para un paquete que se está importando
 *   como histórico.
 */
export async function crearPaquetesEnDeposito(filas: FilaValidada[], userId: string, branchId: string): Promise<ResultadoCreacionFaltantes> {
  const faltantes = filas.filter((f) => f.estado === 'no_encontrado');
  let creados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];
  const codigosCreados: Array<{ fila: number; packageId: string; code: string }> = [];

  for (const bloque of enBloques(faltantes, TAMANO_BLOQUE)) {
    const resultados = await Promise.allSettled(
      bloque.map(async (fila) => {
        if (!fila.fechaRecepcionResuelta) {
          throw new Error('Falta la fecha de recepción (fecha de ingreso a depósito) para esta fila.');
        }

        const code = canonicalizarSeparadores(fila.codigo.trim()).toUpperCase();
        const codigoNormalizado = normalizarCodigo(code);
        const inicial = code.match(/^[A-Z]+/)?.[0];
        if (!inicial) throw new Error('Código sin inicial reconocible.');

        const serie = await prisma.packageSeries.upsert({
          where: { inicial },
          update: {},
          create: { inicial, descripcion: `Serie ${inicial} (creada por importación)`, correlativo: 0 },
        });

        const ingresoAt = new Date(`${fila.fechaRecepcionResuelta}T00:00:00`);

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
              status: 'EN_DEPOSITO',
              ingresoAt,
              depositoAt: ingresoAt,
              origenEntrega: 'IMPORTACION',
              tarifaBaseOverride: serie.tarifaBaseOverride,
              registradoPorId: userId,
              clienteId: cliente?.id ?? null,
              destinatario: fila.personaRecoge || null,
              destinatarioTelefono: fila.celular || null,
              observaciones: fila.observaciones || '',
              descripcion: fila.descripcion || null,
            },
          });
          await tx.packageHistory.create({
            data: { packageId: pkg.id, estado: 'EN_DEPOSITO', fecha: ingresoAt, userId, nota: 'Importación administrativa (depósito histórico)' },
          });
          return pkg;
        }, TRANSACTION_OPTS);

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
 * Actualiza datos seguros (nombre/celular de quien recogió) en paquetes
 * que YA EXISTEN (cualquier estado salvo DENEGADO), sin tocar nunca su
 * status, su fecha de entrega ni su fecha de ingreso — solo completa
 * informacion, tal como pide la especificacion de importacion de entregas
 * historicas (REGLA 1). Se usa tanto para el modo "Solo actualizar datos"
 * como, dentro de ejecutarImportacion(), para completar los datos de
 * filas "ya_entregado" en los otros modos (que de otra forma las
 * ignorarian por completo — ver comentario en ejecutarImportacion()).
 *
 * Seguridad financiera (REGLA 5/6, igual criterio que confirmarImportacion
 * arriba): si el paquete YA tiene un pago, la importacion NUNCA agrega
 * otro, sin importar que traiga el archivo. Si no tiene ningun pago, solo
 * se cobra cuando el archivo trae un monto EXPLICITO para esa fila
 * puntual — nunca una tarifa asumida por defecto (fila.monto ya no se
 * rellena en validarFilas(), ver ese comentario).
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
        if (pkg.status === 'DENEGADO') throw new Error('Este paquete está DENEGADO; no puede modificarse por importación.');

        if (fila.personaRecoge || fila.celular) {
          await prisma.package.update({
            where: { id: pkg.id },
            data: {
              ...(fila.personaRecoge ? { destinatario: fila.personaRecoge } : {}),
              ...(fila.celular ? { destinatarioTelefono: fila.celular } : {}),
            },
          });
        }
        if (pkg.montoPagado <= 0 && fila.monto !== undefined && fila.monto > 0) {
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

export type TipoImportacion = 'SOLO_REGISTRAR' | 'MARCAR_ENTREGADOS' | 'CREAR_Y_ENTREGAR' | 'CREAR_EN_DEPOSITO';

export interface FilaResultado {
  numeroFila: number;
  codigo: string;
  codigoOficial: string | null;
  packageId: string | null;
  monto: number | null;
  persona: string | null;
  estado: string; // VALIDO | DUPLICADO | INVALIDO | NO_ENCONTRADO | YA_ENTREGADO | CREADO | ENTREGADO | SOLO_DATOS | EN_DEPOSITO | ERROR
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
 *
 * REGLA 1 de la especificación de importación histórica ("la importación
 * solo debe completar/actualizar los datos históricos que explícitamente
 * correspondan") aplica sin importar el modo elegido: por eso, en
 * MARCAR_ENTREGADOS y CREAR_Y_ENTREGAR, las filas "ya_entregado" (que esos
 * modos por sí solos jamás tocarían — no cambian de estado, no se crean)
 * igual reciben el mismo paso de completar nombre/celular que el modo
 * "Solo actualizar datos" — nunca se pierde la oportunidad de completar un
 * dato real solo porque el administrador eligió otro modo para el resto
 * del archivo. Nunca se procesan dos veces: cada fila cae en un único
 * bloque según su estado.
 *
 * @param montoDefault Tarifa vigente (company.tarifaBase) a cobrar en
 * paquetes NUEVOS entregados (CREAR_Y_ENTREGAR) cuando su fila no trae un
 * monto explícito — nunca se usa para paquetes existentes (ver
 * validarFilas/crearPaquetesFaltantes).
 */
export async function ejecutarImportacion(
  resumen: ResumenValidacion,
  tipo: TipoImportacion,
  userId: string,
  branchId: string,
  montoDefault: number
): Promise<ResultadoImportacion> {
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
  } else if (tipo === 'CREAR_EN_DEPOSITO') {
    const rd = await crearPaquetesEnDeposito(resumen.filas, userId, branchId);
    creados = rd.creados;
    resumen.filas
      .filter((f) => f.estado === 'no_encontrado')
      .forEach((f) => {
        const err = rd.errores.find((e) => e.fila === f.numeroFila);
        const row = porFila.get(f.numeroFila)!;
        row.estado = err ? 'ERROR' : 'EN_DEPOSITO';
        if (err) row.motivo = err.motivo;
      });
    rd.codigosCreados.forEach((c) => {
      const row = porFila.get(c.fila);
      if (row) {
        row.packageId = c.packageId;
        row.codigoOficial = c.code;
      }
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

    // Completa nombre/celular de las filas "ya_entregado" que este modo,
    // por sí solo, dejaría intactas — ver comentario de la función.
    const yaEntregadas = resumen.filas.filter((f) => f.estado === 'ya_entregado' && f.packageId);
    if (yaEntregadas.length > 0) {
      const rd = await registrarSoloDatos(yaEntregadas, userId);
      actualizados += rd.actualizados;
      yaEntregadas.forEach((f) => {
        const err = rd.errores.find((e) => e.fila === f.numeroFila);
        const row = porFila.get(f.numeroFila)!;
        row.estado = err ? 'ERROR' : 'SOLO_DATOS';
        if (err) row.motivo = err.motivo;
      });
    }

    if (tipo === 'CREAR_Y_ENTREGAR') {
      const rf = await crearPaquetesFaltantes(resumen.filas, userId, branchId, montoDefault);
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

// ---------------------------------------------------------------------
// Eliminar un lote de importación
// ---------------------------------------------------------------------
//
// ImportLog SIEMPRE representa un lote ya APLICADO: la previsualización
// (accion=previsualizar) nunca escribe nada en la base — validarFilas()
// es de solo lectura y ejecutarImportacion()/registrarImportLog() solo se
// llaman despues de "Confirmar importación" (ver POST en
// src/app/api/importacion/route.ts). Por lo tanto no existe hoy ningun
// ImportLog "todavia en previsualización" que sea trivial de borrar por
// definición — la distinción segura no es previsualizado-vs-aplicado,
// sino si el lote aplicado tuvo o no efecto real sobre Package/Pago/
// PackageHistory.
//
// Esto ya es derivable con la estructura existente, sin ningun campo
// nuevo: cada ImportRow guarda el estado final de su fila (ver
// ejecutarImportacion()). Los estados CREADO/ENTREGADO/SOLO_DATOS/
// EN_DEPOSITO son los unicos que pudieron haber creado o modificado un
// Package/Pago/PackageHistory real; INVALIDO/DUPLICADO/NO_ENCONTRADO/
// ERROR nunca tocaron nada. Un lote donde NINGUNA fila quedo en uno de
// esos 4 estados es, por construccion, un intento que no dejo ningun
// rastro financiero/operativo — borrar su ImportLog/ImportRow es
// completamente seguro. Un lote con al menos una fila en esos estados
// representa historia financiera/operativa real y NUNCA se borra (y
// ImportRow.packageId no tiene relacion FK hacia Package — aunque se
// permitiera, borrar el lote jamas podria cascadear hacia Package/Pago/
// PackageHistory; el riesgo real es perder la trazabilidad de un
// movimiento real, no un error de integridad referencial).
export const ESTADOS_CON_EFECTO_REAL = ['CREADO', 'ENTREGADO', 'SOLO_DATOS', 'EN_DEPOSITO'];

export class LoteNoEncontradoError extends Error {
  constructor(id: string) {
    super(`No se encontró ninguna importación con el id "${id}".`);
    this.name = 'LoteNoEncontradoError';
  }
}

export class LoteConEfectoRealError extends Error {
  constructor(public readonly filasConEfecto: number) {
    super(
      `Esta lista ya generó movimientos reales en el sistema (${filasConEfecto} registro(s) creó, entregó o actualizó un paquete) y no puede eliminarse. Los registros históricos y financieros deben conservarse.`
    );
    this.name = 'LoteConEfectoRealError';
  }
}

/** Ids de ImportLog que SÍ pueden eliminarse (cero filas con efecto real) — para marcar el botón en listados sin una consulta por fila. */
export async function getLotesEliminables(importLogIds: string[]): Promise<Set<string>> {
  if (importLogIds.length === 0) return new Set();
  const conEfecto = await prisma.importRow.findMany({
    where: { importLogId: { in: importLogIds }, estado: { in: ESTADOS_CON_EFECTO_REAL } },
    select: { importLogId: true },
    distinct: ['importLogId'],
  });
  const idsConEfecto = new Set(conEfecto.map((f) => f.importLogId));
  return new Set(importLogIds.filter((id) => !idsConEfecto.has(id)));
}

/**
 * Elimina un lote de importación completo (ImportLog + sus ImportRow) —
 * solo si NINGUNA de sus filas tuvo efecto real (ver comentario arriba).
 * Transaccional: el conteo de filas-con-efecto se vuelve a hacer DENTRO
 * de la misma transacción justo antes de borrar (no confía en un chequeo
 * hecho unos milisegundos antes), y si hay aunque sea una, se lanza
 * LoteConEfectoRealError y Prisma revierte todo — no queda ningún
 * ImportRow borrado a medias. Nunca toca Package/Pago/PackageHistory.
 */
export async function eliminarLoteImportacion(id: string, userId: string): Promise<{ nombreArchivo: string; nombreLote: string | null; detectados: number }> {
  const log = await prisma.importLog.findUnique({ where: { id } });
  if (!log) throw new LoteNoEncontradoError(id);

  try {
    await prisma.$transaction(async (tx) => {
      const filasConEfecto = await tx.importRow.count({ where: { importLogId: id, estado: { in: ESTADOS_CON_EFECTO_REAL } } });
      if (filasConEfecto > 0) throw new LoteConEfectoRealError(filasConEfecto);
      await tx.importRow.deleteMany({ where: { importLogId: id } });
      await tx.importLog.delete({ where: { id } });
    }, TRANSACTION_OPTS);
  } catch (err) {
    // Carrera entre dos DELETE simultaneos sobre el mismo lote (ver
    // revision previa a este commit): el "findUnique" de arriba puede
    // encontrar el lote en ambas solicitudes antes de que cualquiera
    // entre a su transaccion; la segunda en llegar a "tx.importLog.delete()"
    // encuentra el registro ya borrado por la primera y Prisma lanza
    // P2025 ("Record to delete does not exist"). Nunca deja nada a medias
    // (la transaccion completa de la segunda solicitud se revierte, igual
    // que cualquier otro error dentro de un $transaction) — solo hace
    // falta traducir ese P2025 al mismo resultado que ya tiene "el lote
    // no existe" (404 limpio), en vez de dejarlo caer al 500 generico.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new LoteNoEncontradoError(id);
    }
    throw err;
  }

  await registrarAuditoria({
    userId,
    accion: 'IMPORTACION_LOTE_ELIMINADO',
    modulo: 'importacion',
    valorAnterior: { id, nombreArchivo: log.nombreArchivo, nombreLote: log.nombreLote, detectados: log.detectados },
  });

  return { nombreArchivo: log.nombreArchivo, nombreLote: log.nombreLote, detectados: log.detectados };
}
