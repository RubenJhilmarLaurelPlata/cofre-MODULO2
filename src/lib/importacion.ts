// src/lib/importacion.ts
// Importacion masiva de codigos (Fase 2): registrar datos, marcar como
// ENTREGADO, o crear+marcar codigos que nunca pasaron por Recepcion.
// Nunca escribe nada durante el parseo/validacion — eso solo ocurre en
// ejecutarImportacion()/crearImportLogInicial()/finalizarImportLog(), y
// siempre despues de que el administrador confirma un resumen ya validado
// contra la BD real.
import ExcelJS from 'exceljs';
import { Prisma, type PackageSeries } from '@prisma/client';
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { normalizarCodigo, canonicalizarSeparadores } from '@/lib/codigo';
import { registrarPagoEnTx, aplicarPagoEnTx } from '@/lib/package-transitions';
import { registrarAuditoria, type RegistrarAuditoriaParams } from '@/lib/auditoria';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { fechaReferencia } from '@/lib/package-detail';
import type { PaymentStatus } from '@/types';

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

/**
 * Fecha operativa de ENTREGA para una fila, con la prioridad correcta
 * (causa raíz del bug de fechas confirmado en auditoría — "Finanzas
 * registraba el cobro con la fecha de HOY en vez de la fecha operativa
 * elegida"):
 *
 *   1. Columna explícita "Fecha de entrega" (fila.fecha/fila.hora) del
 *      archivo, si el administrador la mapeó — permite importar un
 *      archivo donde recepción y entrega ocurrieron en fechas distintas.
 *   2. Si no hay columna de entrega propia, la fecha operativa que el
 *      administrador seleccionó para toda la lista (fila.fechaRecepcionResuelta,
 *      ver OpcionesFechaRecepcion) — el caso normal de "esta lista entera
 *      corresponde a un día histórico", que es exactamente lo que pide la
 *      especificación: la fecha elegida en el paso 2 de Importación es la
 *      fecha operativa de TODO el evento (recepción Y entrega), no solo de
 *      un campo aislado.
 *   3. Solo si ninguna de las dos está presente (el administrador no
 *      seleccionó ninguna fecha y el archivo tampoco trae una), "ahora" —
 *      mismo comportamiento de siempre para una importación sin fechas
 *      históricas.
 *
 * ANTES esta función no existía: cada llamador hacía
 * `parseFechaHora(fila.fecha, fila.hora) ?? new Date()` directo, saltando
 * el paso 2 por completo — así es como un import con fecha única
 * 27/08/2026 pero sin columna de "fecha de entrega" en el Excel terminaba
 * con entregaAt/Pago.createdAt en la fecha REAL de ejecución (hoy) en vez
 * de la fecha operativa elegida.
 */
function fechaOperativaFallback(fila: Pick<FilaValidada, 'fecha' | 'hora' | 'fechaRecepcionResuelta'>): Date {
  return parseFechaHora(fila.fecha, fila.hora) ?? (fila.fechaRecepcionResuelta ? new Date(`${fila.fechaRecepcionResuelta}T00:00:00`) : new Date());
}

/** Info de progreso de UNA fila ya procesada (ok o con error), para que el llamador (la ruta HTTP) pueda reportarlo en vivo por SSE — ver src/lib/importacion-jobs.ts. */
export interface ProgresoFila {
  numeroFila: number;
  codigo: string;
  accion: string;
}
export type OnProgreso = (info: ProgresoFila, huboError: boolean) => void;

// ---------------------------------------------------------------------
// Arquitectura de escritura masiva (bloques + SAVEPOINT)
// ---------------------------------------------------------------------
//
// Antes (hasta la version anterior de este archivo): cada fila abria su
// PROPIA transaccion fisica (`prisma.$transaction`, con su propio
// BEGIN/COMMIT/fsync — ver TRANSACTION_OPTS en src/lib/prisma.ts), y las
// filas de un mismo bloque se lanzaban con `Promise.allSettled` +
// `bloque.map(...)`, es decir, hasta 250 transacciones/round-trips
// intentando avanzar EN PARALELO sobre la unica conexion que permite
// `connection_limit=1`. En un import de 1.999 filas eso son hasta 1.999
// transacciones fisicas y hasta 250 escrituras "simultaneas" compitiendo
// por una conexion que solo puede atender una a la vez — la causa real
// del riesgo de SQLITE_BUSY/504 en produccion con archivos grandes.
//
// Ahora: cada BLOQUE de ~200 filas es UNA sola transaccion fisica
// (un solo BEGIN/COMMIT/fsync para las 200), y las filas dentro del
// bloque se procesan de forma estrictamente SECUENCIAL (nunca paralela)
// usando SAVEPOINT/RELEASE/ROLLBACK TO (ver conSavepoint() mas abajo)
// para que una fila con error revierta UNICAMENTE sus propios cambios,
// sin afectar a las demas filas ya confirmadas del mismo bloque ni forzar
// una transaccion fisica por fila. Para 1.999 filas esto son ~10
// transacciones fisicas en vez de ~1.999, sin perder el aislamiento por
// fila que ya se probo necesario (una fila mala no debe tumbar al resto).
//
// Verificado con una prueba real y aislada contra SQLite (ver commit):
// SAVEPOINT/ROLLBACK TO SAVEPOINT dentro de una transaccion interactiva
// de Prisma 5.19.1 revierte solo la fila fallida y deja la transaccion
// perfectamente utilizable para las filas siguientes; y NUNCA debe
// llamarse al cliente `prisma` de nivel superior (ej. registrarAuditoria)
// desde DENTRO de esa transaccion — con connection_limit=1 eso se cuelga
// para siempre (la unica conexion ya esta tomada). Por eso cada funcion
// de escritura junta las auditorias pendientes durante el bloque y las
// ejecuta recien DESPUES de que la transaccion del bloque hizo commit.
const TAMANO_BLOQUE = 200;

// Limite de tiempo para la transaccion fisica de UN bloque completo (no
// de una fila). Con SAVEPOINT en vez de COMMIT por fila, el costo de
// fsync solo se paga una vez por bloque (no por fila) — 200 filas con
// unas pocas escrituras cada una tardan, en la practica, un orden de
// magnitud menos que esto; el margen es deliberadamente generoso para
// tolerar un disco/CPU cargado sin ocultar un problema real (ver
// benchmark real reportado al final del cambio) — nunca se subio a algo
// como 5 minutos solo para evitar ver un timeout.
const TIMEOUT_BLOQUE_MS = 30_000;

function enBloques<T>(items: T[], tamano: number): T[][] {
  const bloques: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) bloques.push(items.slice(i, i + tamano));
  return bloques;
}

/**
 * Ejecuta fn() dentro de un SAVEPOINT propio de esta fila, dentro de una
 * transaccion de bloque ya abierta (tx). Si fn() falla, revierte SOLO los
 * cambios de esta fila (ROLLBACK TO SAVEPOINT) sin afectar las demas
 * filas ya confirmadas (RELEASE) del mismo bloque, y relanza el error
 * original para que el llamador lo registre como el error de esta fila
 * puntual — igual comportamiento observable que antes (una fila con error
 * no tumba a las demas), solo que ahora sin pagar una transaccion fisica
 * por fila.
 *
 * "indice" es siempre un numero generado internamente (la posicion de la
 * fila dentro del bloque, 0..bloque.length-1) — el nombre del SAVEPOINT
 * se arma a partir de ese numero, NUNCA de un dato proveniente del
 * archivo/usuario (codigo, nombre, etc.), para que sea imposible
 * interpolar algo controlado por el archivo importado dentro del SQL.
 */
async function conSavepoint<T>(tx: Prisma.TransactionClient, indice: number, fn: () => Promise<T>): Promise<T> {
  const nombre = `sp_${indice}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${nombre}`);
  try {
    const valor = await fn();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nombre}`);
    return valor;
  } catch (err) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${nombre}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nombre}`);
    throw err;
  }
}

interface ResultadoFilaBloque<T> {
  numeroFila: number;
  ok: boolean;
  valor?: T;
  error?: unknown;
}

/**
 * Orquestador comun de la arquitectura de bloques: agrupa "filas" en
 * bloques de TAMANO_BLOQUE, abre UNA transaccion fisica por bloque, y
 * dentro de ella procesa cada fila secuencialmente envuelta en su propio
 * SAVEPOINT (conSavepoint). Usado por las 4 funciones de escritura masiva
 * (confirmarImportacion, crearPaquetesFaltantes, crearPaquetesEnDeposito,
 * registrarSoloDatos) para que las 4 compartan EXACTAMENTE la misma
 * mecanica de transaccion/aislamiento — la logica de negocio de cada una
 * (que campos escribe, que financiero aplica) vive entera en
 * "procesarFila", nunca aqui.
 *
 * "auditoriasPendientes" (out param): cada fila puede devolver, junto a su
 * valor, una funcion `auditoria` opcional (ej. cuando registro un cobro) —
 * esas funciones se acumulan aqui y el llamador las ejecuta DESPUES de
 * cada bloque (nunca dentro del bloque, ver comentario de conSavepoint /
 * registrarPagoEnTx sobre por que eso se colgaria).
 */
/**
 * "onProgreso" (opcional): se dispara UNA VEZ por fila, justo despues de
 * resolverla (ok o error) — nunca desde dentro del SAVEPOINT (evita que un
 * callback lento retrase el commit del bloque) y nunca en paralelo (la
 * arquitectura sigue siendo estrictamente secuencial dentro de cada
 * bloque). "accionFila" convierte la fila en el texto que ve el
 * administrador en vivo (ej. "Creando paquete...") — cada funcion de
 * escritura masiva pasa la suya propia porque cada una hace algo distinto.
 */
async function procesarEnBloques<F extends { numeroFila: number; codigo: string }, T extends { auditoria?: () => Promise<void> }>(
  filas: F[],
  procesarFila: (tx: Prisma.TransactionClient, fila: F) => Promise<T>,
  opts?: { onProgreso?: OnProgreso; accionFila?: (fila: F) => string }
): Promise<ResultadoFilaBloque<T>[]> {
  const resultados: ResultadoFilaBloque<T>[] = [];

  for (const bloque of enBloques(filas, TAMANO_BLOQUE)) {
    const resultadosBloque: ResultadoFilaBloque<T>[] = [];

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < bloque.length; i++) {
        const fila = bloque[i]!;
        try {
          const valor = await conSavepoint(tx, i, () => procesarFila(tx, fila));
          resultadosBloque.push({ numeroFila: fila.numeroFila, ok: true, valor });
        } catch (error) {
          resultadosBloque.push({ numeroFila: fila.numeroFila, ok: false, error });
        }
      }
    }, { maxWait: TRANSACTION_OPTS.maxWait, timeout: TIMEOUT_BLOQUE_MS });

    // Las auditorias de este bloque recien se disparan aqui, con la
    // transaccion ya confirmada (commit) — nunca desde adentro.
    for (const r of resultadosBloque) {
      if (r.ok && r.valor?.auditoria) await r.valor.auditoria();
    }

    if (opts?.onProgreso) {
      for (let i = 0; i < bloque.length; i++) {
        const fila = bloque[i]!;
        const r = resultadosBloque[i]!;
        opts.onProgreso({ numeroFila: fila.numeroFila, codigo: fila.codigo, accion: opts.accionFila?.(fila) ?? 'Procesando...' }, !r.ok);
      }
    }

    resultados.push(...resultadosBloque);
  }

  return resultados;
}

/**
 * Resuelve (o crea) la PackageSeries de cada inicial DISTINTA presente en
 * las filas que van a crear un paquete nuevo — UNA SOLA VEZ para todo el
 * lote, antes de procesar ninguna fila. Antes, crearPaquetesFaltantes()/
 * crearPaquetesEnDeposito() hacian un `packageSeries.upsert()` POR FILA
 * (hasta 1.999 upserts identicos para el mismo puñado real de iniciales
 * distintas en un archivo tipico). Secuencial a proposito (no
 * concurrente): son pocas iniciales incluso en archivos grandes, y evita
 * dos upsert simultaneos sobre la misma fila de PackageSeries. El
 * resultado final en la base es identico a hacerlo por fila (upsert es
 * idempotente e independiente del orden).
 */
async function resolverSeriesUnaVez(filas: FilaValidada[]): Promise<Map<string, PackageSeries>> {
  const iniciales = new Set<string>();
  for (const fila of filas) {
    const code = canonicalizarSeparadores(fila.codigo.trim()).toUpperCase();
    const inicial = code.match(/^[A-Z]+/)?.[0];
    if (inicial) iniciales.add(inicial);
  }

  const cache = new Map<string, PackageSeries>();
  for (const inicial of iniciales) {
    const serie = await prisma.packageSeries.upsert({
      where: { inicial },
      update: {},
      create: { inicial, descripcion: `Serie ${inicial} (creada por importación)`, correlativo: 0 },
    });
    cache.set(inicial, serie);
  }
  return cache;
}

export interface ResultadoConfirmacion {
  marcadosEntregado: number;
  yaEntregados: number;
  errores: Array<{ fila: number; motivo: string }>;
}

interface ResultadoFilaConfirmacion {
  entregado: boolean;
  auditoria?: () => Promise<void>;
}

/** Marca como ENTREGADO cada fila "valido" de una validacion ya hecha. Nunca crea paquetes que no existen (ver crearPaquetesFaltantes). */
export async function confirmarImportacion(
  filas: FilaValidada[],
  userId: string,
  opts?: { importLogId?: string; onProgreso?: OnProgreso }
): Promise<ResultadoConfirmacion> {
  const aProcesar = filas.filter((f) => f.estado === 'valido' && f.packageId);
  let marcadosEntregado = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];

  // Cargados una sola vez para todo el lote — ver mismo criterio en
  // crearPaquetesFaltantes(). Necesario aqui porque registrarPagoEnTx()
  // (a diferencia de registrarPago()) no los vuelve a consultar el mismo.
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  const reglas = { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia };

  const resultados = await procesarEnBloques<FilaValidada, ResultadoFilaConfirmacion>(
    aProcesar,
    async (tx, fila) => {
      const pkg = await tx.package.findUnique({ where: { id: fila.packageId! } });
      if (!pkg || pkg.status === 'ENTREGADO' || pkg.status === 'DENEGADO') return { entregado: false }; // cambio de estado mientras tanto: se salta, no se rompe el resto

      // Fecha operativa de entrega — ver fechaOperativaFallback(): respeta
      // la fecha elegida en el paso 2 de Importación (fechaRecepcionResuelta)
      // cuando el archivo no trae una columna de "fecha de entrega" propia
      // para esta fila. Antes caía directo a "ahora", que es la causa raíz
      // confirmada en auditoría del bug "Finanzas cobra hoy en vez del día
      // seleccionado".
      const entregaAt = fechaOperativaFallback(fila);

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
      if (res.count === 0) return { entregado: false };
      await tx.packageHistory.create({
        data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa', importLogId: opts?.importLogId ?? null },
      });

      // Seguridad financiera (REGLA 5/6): "pkg" se releyo justo arriba,
      // dentro de este mismo SAVEPOINT, asi que "pkg.montoPagado" es el
      // valor real al momento de procesar esta fila (no el de la
      // previsualizacion, que pudo haber quedado desactualizada). Si el
      // paquete YA tenia algun pago (ej. un anticipo cargado en Recepcion),
      // la importacion NUNCA agrega otro movimiento — evita duplicar/inflar
      // un cobro sobre un paquete que ya traia su propio dinero real. Solo
      // se cobra cuando no habia ningun pago Y el archivo trajo un monto
      // EXPLICITO para esta fila (fila.monto !== undefined) — nunca una
      // tarifa asumida (ver validarFilas(): esta funcion ya no rellena
      // fila.monto con ningun valor por defecto).
      if (pkg.montoPagado <= 0 && fila.monto !== undefined && fila.monto > 0) {
        // "entregaAt" (no "ahora"): si el archivo trae fecha, el cobro debe
        // quedar contabilizado en Finanzas ese dia — nunca hoy (ver
        // especificacion, "Importacion con fechas").
        const actualizado = await registrarPagoEnTx(tx, pkg, 'COBRO_ENTREGA', fila.monto, userId, reglas, feriados, 'Importación administrativa', entregaAt, opts?.importLogId);
        return {
          entregado: true,
          auditoria: () =>
            registrarAuditoria({
              userId: userId ?? undefined,
              accion: 'PAGO_COBRO_ENTREGA',
              modulo: 'finanzas',
              valorAnterior: { code: pkg.code, montoPagado: pkg.montoPagado },
              valorNuevo: { code: pkg.code, montoPagado: actualizado.montoPagado, motivo: 'Importación administrativa' },
            } satisfies RegistrarAuditoriaParams),
        };
      }
      return { entregado: true };
    },
    { onProgreso: opts?.onProgreso, accionFila: () => 'Marcando entregado...' }
  );

  resultados.forEach((r) => {
    if (r.ok) {
      if (r.valor?.entregado) marcadosEntregado++;
    } else {
      errores.push({ fila: r.numeroFila, motivo: r.error instanceof Error ? r.error.message : 'Error desconocido' });
    }
  });

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
interface ResultadoFilaCreacion {
  packageId: string;
  code: string;
  auditoria?: () => Promise<void>;
}

export async function crearPaquetesFaltantes(
  filas: FilaValidada[],
  userId: string,
  branchId: string,
  montoDefault: number,
  opts?: { importLogId?: string; onProgreso?: OnProgreso }
): Promise<ResultadoCreacionFaltantes> {
  const faltantes = filas.filter((f) => f.estado === 'no_encontrado');
  let creados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];
  const codigosCreados: Array<{ fila: number; packageId: string; code: string }> = [];
  // Cargados una sola vez para todo el lote (no cambian entre filas de la
  // misma corrida) — evita una consulta de configuracion/feriados por
  // fila, y es lo que aplicarPagoEnTx() necesita para calcular el costo
  // vigente de cada paquete nuevo dentro de su propia transaccion.
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  // Resuelto UNA VEZ para todo el lote (ver resolverSeriesUnaVez) — antes
  // era un upsert por fila, aunque compartieran la misma inicial.
  const seriesCache = await resolverSeriesUnaVez(faltantes);

  const resultados = await procesarEnBloques<FilaValidada, ResultadoFilaCreacion>(
    faltantes,
    async (tx, fila) => {
      // canonicalizarSeparadores() antes de guardar: si la celda del Excel
      // trae "M19A/29" (u otro separador equivalente, ver src/lib/codigo.ts),
      // el paquete debe quedar creado como "M19A-29" — el formato canonico —
      // nunca con el separador tal cual vino del archivo.
      const code = canonicalizarSeparadores(fila.codigo.trim()).toUpperCase();
      const codigoNormalizado = normalizarCodigo(code);
      const inicial = code.match(/^[A-Z]+/)?.[0];
      if (!inicial) throw new Error('Código sin inicial reconocible.');

      const serie = seriesCache.get(inicial);
      if (!serie) throw new Error('Código sin inicial reconocible.');

      // Fecha operativa de entrega — ver fechaOperativaFallback(): un
      // paquete creado por "Crear faltantes y entregar" es, por
      // definición, un evento histórico completo (recepción + entrega el
      // mismo día que indica la importación); si el archivo no trae una
      // columna de "fecha de entrega" propia, usa la fecha operativa
      // elegida en el paso 2 en vez de "ahora" (causa raíz del bug de
      // fechas — ver auditoría).
      const entregaAt = fechaOperativaFallback(fila);
      // Fecha de recepcion (concepto nuevo, ver validarFilas): si la fila
      // trae una resuelta (fecha unica del archivo, o interpretada de su
      // propia columna), esa es la fecha REAL de ingreso — nunca mas
      // forzada a ser igual a la fecha de entrega. Si no se configuro
      // ninguna, se mantiene el comportamiento de siempre (ingresoAt =
      // entregaAt).
      const ingresoAt = fila.fechaRecepcionResuelta ? new Date(`${fila.fechaRecepcionResuelta}T00:00:00`) : entregaAt;

      let cliente = null;
      if (fila.cliente || fila.emprendimiento) {
        cliente = await tx.cliente.create({ data: { nombre: fila.cliente || null, emprendimiento: fila.emprendimiento || null } });
      }

      // Monto a cobrar: explicito del archivo/edicion si vino, si no la
      // tarifa por defecto — nunca undefined para un paquete NUEVO (ver
      // REGLA 4: una entrega historica nueva siempre debe impactar
      // Finanzas, con su fecha historica).
      const montoAplicado = fila.monto ?? montoDefault;

      // Atomico dentro de este SAVEPOINT (package.create + 2×packageHistory
      // + pago): si algo falla, ROLLBACK TO revierte unicamente esta fila —
      // nunca queda un paquete ENTREGADO+Bs0+SIN Pago (mismo patron de bug
      // ya corregido para entregaExcepcional(), ver ese comentario en
      // src/lib/package-transitions.ts).
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
      await tx.packageHistory.create({
        data: { packageId: pkg.id, estado: 'EN_PAQUETERIA', fecha: ingresoAt, userId, nota: 'Importación administrativa (registro faltante)', importLogId: opts?.importLogId ?? null },
      });
      await tx.packageHistory.create({
        data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: entregaAt, userId, nota: 'Importación administrativa (registro faltante)', importLogId: opts?.importLogId ?? null },
      });
      if (montoAplicado > 0) {
        const costoActual = calcularCosto(
          pkg.ingresoAt,
          fechaReferencia(pkg),
          { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
          feriados,
          pkg.tarifaBaseOverride,
          pkg.diasIncluidosOverride
        ).total;
        // "entregaAt" (no "ahora"): si el archivo trae fecha, el cobro debe
        // quedar contabilizado en Finanzas ese dia — nunca hoy (ver
        // especificacion, "Importacion con fechas").
        await aplicarPagoEnTx(tx, pkg.id, 0, montoAplicado, costoActual, 'COBRO_ENTREGA', userId, 'Importación administrativa (registro faltante)', entregaAt, opts?.importLogId);
      }

      return { packageId: pkg.id, code: pkg.code };
    },
    { onProgreso: opts?.onProgreso, accionFila: () => 'Creando paquete...' }
  );

  resultados.forEach((r) => {
    if (r.ok && r.valor) {
      creados++;
      codigosCreados.push({ fila: r.numeroFila, packageId: r.valor.packageId, code: r.valor.code });
    } else if (!r.ok) {
      errores.push({ fila: r.numeroFila, motivo: r.error instanceof Error ? r.error.message : 'Error desconocido' });
    }
  });

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
export async function crearPaquetesEnDeposito(
  filas: FilaValidada[],
  userId: string,
  branchId: string,
  opts?: { importLogId?: string; onProgreso?: OnProgreso }
): Promise<ResultadoCreacionFaltantes> {
  const faltantes = filas.filter((f) => f.estado === 'no_encontrado');
  let creados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];
  const codigosCreados: Array<{ fila: number; packageId: string; code: string }> = [];
  const seriesCache = await resolverSeriesUnaVez(faltantes);

  const resultados = await procesarEnBloques<FilaValidada, { packageId: string; code: string; auditoria?: () => Promise<void> }>(
    faltantes,
    async (tx, fila) => {
      if (!fila.fechaRecepcionResuelta) {
        throw new Error('Falta la fecha de recepción (fecha de ingreso a depósito) para esta fila.');
      }

      const code = canonicalizarSeparadores(fila.codigo.trim()).toUpperCase();
      const codigoNormalizado = normalizarCodigo(code);
      const inicial = code.match(/^[A-Z]+/)?.[0];
      if (!inicial) throw new Error('Código sin inicial reconocible.');

      const serie = seriesCache.get(inicial);
      if (!serie) throw new Error('Código sin inicial reconocible.');

      const ingresoAt = new Date(`${fila.fechaRecepcionResuelta}T00:00:00`);

      let cliente = null;
      if (fila.cliente || fila.emprendimiento) {
        cliente = await tx.cliente.create({ data: { nombre: fila.cliente || null, emprendimiento: fila.emprendimiento || null } });
      }

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
        data: { packageId: pkg.id, estado: 'EN_DEPOSITO', fecha: ingresoAt, userId, nota: 'Importación administrativa (depósito histórico)', importLogId: opts?.importLogId ?? null },
      });

      return { packageId: pkg.id, code: pkg.code };
    },
    { onProgreso: opts?.onProgreso, accionFila: () => 'Creando en depósito...' }
  );

  resultados.forEach((r) => {
    if (r.ok && r.valor) {
      creados++;
      codigosCreados.push({ fila: r.numeroFila, packageId: r.valor.packageId, code: r.valor.code });
    } else if (!r.ok) {
      errores.push({ fila: r.numeroFila, motivo: r.error instanceof Error ? r.error.message : 'Error desconocido' });
    }
  });

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
export async function registrarSoloDatos(
  filas: FilaValidada[],
  userId: string,
  opts?: { importLogId?: string; onProgreso?: OnProgreso }
): Promise<ResultadoSoloDatos> {
  const aProcesar = filas.filter((f) => (f.estado === 'valido' || f.estado === 'ya_entregado') && f.packageId);
  let actualizados = 0;
  const errores: Array<{ fila: number; motivo: string }> = [];

  // Cargados una sola vez para todo el lote — ver mismo criterio en
  // crearPaquetesFaltantes()/confirmarImportacion().
  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  const reglas = { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia };

  const resultados = await procesarEnBloques<FilaValidada, { auditoria?: () => Promise<void> }>(
    aProcesar,
    async (tx, fila) => {
      const pkg = await tx.package.findUnique({ where: { id: fila.packageId! } });
      if (!pkg) throw new Error('El paquete ya no existe.');
      if (pkg.status === 'DENEGADO') throw new Error('Este paquete está DENEGADO; no puede modificarse por importación.');

      if (fila.personaRecoge || fila.celular) {
        await tx.package.update({
          where: { id: pkg.id },
          data: {
            ...(fila.personaRecoge ? { destinatario: fila.personaRecoge } : {}),
            ...(fila.celular ? { destinatarioTelefono: fila.celular } : {}),
          },
        });
      }
      if (pkg.montoPagado <= 0 && fila.monto !== undefined && fila.monto > 0) {
        // Misma fecha operativa que el resto del lote (ver
        // fechaOperativaFallback): antes esta llamada no pasaba ninguna
        // fecha, así que el ajuste siempre quedaba fechado "ahora" en vez
        // del día que el administrador seleccionó para toda la lista.
        const fechaMovimiento = fechaOperativaFallback(fila);
        const actualizado = await registrarPagoEnTx(tx, pkg, 'AJUSTE', fila.monto, userId, reglas, feriados, 'Importación administrativa (solo datos)', fechaMovimiento, opts?.importLogId);
        return {
          auditoria: () =>
            registrarAuditoria({
              userId: userId ?? undefined,
              accion: 'PAGO_AJUSTE',
              modulo: 'finanzas',
              valorAnterior: { code: pkg.code, montoPagado: pkg.montoPagado },
              valorNuevo: { code: pkg.code, montoPagado: actualizado.montoPagado, motivo: 'Importación administrativa (solo datos)' },
            } satisfies RegistrarAuditoriaParams),
        };
      }
      return {};
    },
    { onProgreso: opts?.onProgreso, accionFila: () => 'Actualizando datos...' }
  );

  resultados.forEach((r) => {
    if (r.ok) actualizados++;
    else errores.push({ fila: r.numeroFila, motivo: r.error instanceof Error ? r.error.message : 'Error desconocido' });
  });

  return { actualizados, errores };
}

export type TipoImportacion = 'SOLO_REGISTRAR' | 'MARCAR_ENTREGADOS' | 'CREAR_Y_ENTREGAR' | 'CREAR_EN_DEPOSITO';

/**
 * Cuántas filas va a tocar realmente ejecutarImportacion() para este tipo
 * — el "total" real del progreso (ver src/lib/importacion-jobs.ts), no
 * simplemente resumen.detectados (que incluye inválidos/duplicados que
 * ningún modo procesa nunca). Misma clasificación que usa
 * ejecutarImportacion() internamente; se calcula aparte, ANTES de arrancar
 * el procesamiento, porque el job de progreso necesita saber el total
 * desde el primer momento.
 */
export function contarFilasAProcesar(resumen: ResumenValidacion, tipo: TipoImportacion): number {
  const validoConPkg = resumen.filas.filter((f) => f.estado === 'valido' && f.packageId).length;
  const yaEntregadoConPkg = resumen.filas.filter((f) => f.estado === 'ya_entregado' && f.packageId).length;
  const noEncontrado = resumen.filas.filter((f) => f.estado === 'no_encontrado').length;
  if (tipo === 'SOLO_REGISTRAR') return validoConPkg + yaEntregadoConPkg;
  if (tipo === 'CREAR_EN_DEPOSITO') return noEncontrado;
  if (tipo === 'CREAR_Y_ENTREGAR') return validoConPkg + yaEntregadoConPkg + noEncontrado;
  return validoConPkg + yaEntregadoConPkg; // MARCAR_ENTREGADOS
}

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
  montoDefault: number,
  opts?: { importLogId?: string; onProgreso?: OnProgreso }
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
    const r = await registrarSoloDatos(resumen.filas, userId, opts);
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
    const rd = await crearPaquetesEnDeposito(resumen.filas, userId, branchId, opts);
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
    const r = await confirmarImportacion(resumen.filas, userId, opts);
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
      const rd = await registrarSoloDatos(yaEntregadas, userId, opts);
      actualizados += rd.actualizados;
      yaEntregadas.forEach((f) => {
        const err = rd.errores.find((e) => e.fila === f.numeroFila);
        const row = porFila.get(f.numeroFila)!;
        row.estado = err ? 'ERROR' : 'SOLO_DATOS';
        if (err) row.motivo = err.motivo;
      });
    }

    if (tipo === 'CREAR_Y_ENTREGAR') {
      const rf = await crearPaquetesFaltantes(resumen.filas, userId, branchId, montoDefault, opts);
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

// ---------------------------------------------------------------------
// Registro del lote (dos fases)
// ---------------------------------------------------------------------
//
// ANTES: registrarImportLog() creaba el ImportLog DESPUES de que
// ejecutarImportacion() ya habia procesado todo el archivo — asi que
// durante el procesamiento (confirmarImportacion/crearPaquetesFaltantes/
// etc.) todavia no existia ningun id de ImportLog para pasarle a los Pago/
// PackageHistory que se iban creando, y por eso Pago.importLogId/
// PackageHistory.importLogId no se podian completar (necesarios para que
// revertirLoteImportacion() sepa, sin ambiguedad, que movimiento vino de
// que importacion — ver auditoria, "Muy importante: eliminacion/reversion
// de importaciones").
//
// AHORA: crearImportLogInicial() crea el ImportLog PRIMERO (con los
// conteos que validarFilas() ya conoce de antemano — detectados/validos/
// duplicados/invalidos/noEncontrados no cambian durante la ejecucion), la
// ruta le pasa ese id a ejecutarImportacion() para que cada escritura real
// quede marcada con el, y recien al final finalizarImportLog() completa
// los conteos que solo se conocen despues de procesar (marcadosEntregado/
// creadosFaltantes/detalleErrores) y crea los ImportRow — mismo contenido
// final que antes, solo que en dos pasos en vez de uno.
export async function crearImportLogInicial(params: {
  nombreArchivo: string;
  nombreLote?: string;
  formato: FormatoImportacion;
  resumen: ResumenValidacion;
  tipo: TipoImportacion;
  userId: string;
}): Promise<string> {
  const log = await prisma.importLog.create({
    data: {
      nombreArchivo: params.nombreArchivo,
      nombreLote: params.nombreLote || null,
      formato: params.formato,
      tipoImportacion: params.tipo,
      detectados: params.resumen.detectados,
      validos: params.resumen.validos,
      duplicados: params.resumen.duplicados,
      invalidos: params.resumen.invalidos,
      noEncontrados: params.resumen.noEncontrados,
      userId: params.userId,
    },
  });
  return log.id;
}

export async function finalizarImportLog(params: {
  importLogId: string;
  nombreArchivo: string;
  nombreLote?: string;
  resumen: ResumenValidacion;
  resultado: ResultadoImportacion;
  userId: string;
}): Promise<void> {
  await prisma.importLog.update({
    where: { id: params.importLogId },
    data: {
      marcadosEntregado: params.resultado.entregados,
      creadosFaltantes: params.resultado.creados,
      detalleErrores: params.resultado.conError
        ? JSON.stringify(params.resultado.filas.filter((f) => f.estado === 'ERROR').map((f) => ({ fila: f.numeroFila, motivo: f.motivo })))
        : null,
    },
  });

  // Trocear en bloques de ~500: createMany ya es una sola operacion bulk
  // (nunca una insercion por fila), esto es solo una medida defensiva para
  // archivos muy grandes (5.000-10.000+ filas), donde una unica llamada
  // podria acercarse al limite de parametros SQL de SQLite. No cambia
  // ningun dato almacenado — mismos valores, mismas filas.
  for (const bloqueFilas of enBloques(params.resultado.filas, 500)) {
    if (bloqueFilas.length === 0) continue;
    await prisma.importRow.createMany({
      data: bloqueFilas.map((f) => ({
        importLogId: params.importLogId,
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

// ---------------------------------------------------------------------
// Revertir un lote de importación (deshace efectos reales)
// ---------------------------------------------------------------------
//
// Distinto de eliminarLoteImportacion() de arriba (que solo borra lotes
// SIN NINGÚN efecto real): esto es para el caso contrario — un lote que
// SÍ creó/entregó/actualizó paquetes reales (típicamente una prueba mal
// configurada) y que el administrador quiere deshacer explícitamente. El
// ImportLog/ImportRow NUNCA se borran aquí (quedan como el rastro de "esto
// se importó y luego se revirtió", vía revertidoAt/revertidoPorId) —
// borrarlos perdería la auditoría de que la reversión ocurrió.
//
// Solo es posible con exactitud gracias a Pago.importLogId/
// PackageHistory.importLogId (ver schema.prisma): antes de esos campos no
// había forma de distinguir, mirando un Pago o un PackageHistory
// cualquiera, si lo generó ESTA importación puntual — la auditoría de Fase
// 1 documentó esto como un límite real de datos, no una omisión de
// código, y la migración aditiva lo resuelve.
//
// SEGURIDAD ("nunca inventar una restauración" — ver especificación,
// sección 8): cada fila con efecto real solo se revierte si el paquete NO
// fue tocado por nada más después de esta importación (mismo status que
// dejó, mismo origenEntrega, ningún Pago/PackageHistory ajeno posterior).
// Si algo cambió después, la fila queda en "noReversibles" con el motivo
// — nunca se fuerza una reversión que podría perder un dato real. Y para
// SOLO_DATOS, el nombre/celular sobrescrito NUNCA se restaura (no existe
// ningún registro del valor anterior en este esquema): solo se revierte el
// dinero (si lo hubo), y esto se declara explícitamente en el resultado
// (actualizacionesNoRevertidas) para que el administrador lo sepa antes de
// confirmar.

export class LoteYaRevertidoError extends Error {
  constructor(id: string) {
    super(`La importación "${id}" ya fue revertida anteriormente.`);
    this.name = 'LoteYaRevertidoError';
  }
}

export class LoteSinEfectoParaRevertirError extends Error {
  constructor() {
    super('Esta lista no generó ningún movimiento real — usa "Eliminar lista" en vez de "Revertir".');
    this.name = 'LoteSinEfectoParaRevertirError';
  }
}

export interface FilaNoReversible {
  codigo: string;
  motivo: string;
}

export interface ResultadoReversion {
  paquetesEliminados: number;
  entregasRevertidas: number;
  pagosRevertidos: number;
  // SOLO_DATOS cuyo nombre/celular sobrescrito NO pudo restaurarse (nunca
  // se guardó el valor anterior) — su eventual Pago SÍ se revierte si lo
  // hubo; esto solo cuenta las filas, para que el admin sepa que ese texto
  // quedó como estaba tras la importación.
  actualizacionesNoRevertidas: number;
  noReversibles: FilaNoReversible[];
}

/**
 * Vista previa de qué haría revertirLoteImportacion() SIN escribir nada —
 * usada por la ruta para armar el diálogo de confirmación fuerte que pide
 * la especificación ("¿Revertir importación...? Esto eliminará/revertirá:
 * X paquetes creados, X entregas, X movimientos financieros...").
 */
export async function previsualizarReversion(id: string): Promise<ResultadoReversion & { yaRevertido: boolean }> {
  const log = await prisma.importLog.findUnique({ where: { id } });
  if (!log) throw new LoteNoEncontradoError(id);
  const plan = await planificarReversion(id);
  return {
    paquetesEliminados: plan.paraEliminar.length,
    entregasRevertidas: plan.paraRevertirEntrega.length,
    pagosRevertidos: plan.paraRevertirEntrega.filter((p) => p.pagoId).length + plan.paraRevertirSoloDatos.filter((p) => p.pagoId).length,
    actualizacionesNoRevertidas: plan.paraRevertirSoloDatos.length,
    noReversibles: plan.noReversibles,
    yaRevertido: !!log.revertidoAt,
  };
}

interface PlanEliminar {
  packageId: string;
}
interface PlanEntrega {
  packageId: string;
  estadoAnterior: string;
  pagoId?: string;
}
interface PlanSoloDatos {
  packageId: string;
  pagoId?: string;
}

/**
 * Fase de SOLO LECTURA: decide, para cada fila con efecto real de este
 * lote, si es segura de revertir — nunca escribe nada. Carga
 * paquetes/historial/pagos en 3 consultas batched (nunca una por fila,
 * mismo criterio N+1 que el resto del módulo) para los packageId
 * involucrados, sin importar cuántas filas tenga el lote.
 */
async function planificarReversion(importLogId: string): Promise<{
  paraEliminar: PlanEliminar[];
  paraRevertirEntrega: PlanEntrega[];
  paraRevertirSoloDatos: PlanSoloDatos[];
  noReversibles: FilaNoReversible[];
}> {
  const filas = await prisma.importRow.findMany({
    where: { importLogId, estado: { in: ESTADOS_CON_EFECTO_REAL } },
    select: { codigo: true, codigoOficial: true, packageId: true, estado: true },
  });

  const packageIds = Array.from(new Set(filas.map((f) => f.packageId).filter((x): x is string => !!x)));
  const [paquetes, historiales, pagos] = await Promise.all([
    packageIds.length ? prisma.package.findMany({ where: { id: { in: packageIds } } }) : Promise.resolve([]),
    packageIds.length ? prisma.packageHistory.findMany({ where: { packageId: { in: packageIds } }, orderBy: { fecha: 'asc' } }) : Promise.resolve([]),
    packageIds.length ? prisma.pago.findMany({ where: { packageId: { in: packageIds } }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
  ]);
  const paquetePorId = new Map(paquetes.map((p) => [p.id, p]));
  const historialPorPaquete = new Map<string, typeof historiales>();
  for (const h of historiales) historialPorPaquete.set(h.packageId, [...(historialPorPaquete.get(h.packageId) ?? []), h]);
  const pagosPorPaquete = new Map<string, typeof pagos>();
  for (const p of pagos) pagosPorPaquete.set(p.packageId, [...(pagosPorPaquete.get(p.packageId) ?? []), p]);

  const paraEliminar: PlanEliminar[] = [];
  const paraRevertirEntrega: PlanEntrega[] = [];
  const paraRevertirSoloDatos: PlanSoloDatos[] = [];
  const noReversibles: FilaNoReversible[] = [];

  for (const fila of filas) {
    const codigoMostrado = fila.codigoOficial ?? fila.codigo;
    if (!fila.packageId) {
      noReversibles.push({ codigo: codigoMostrado, motivo: 'No quedó vinculado a ningún paquete.' });
      continue;
    }
    const pkg = paquetePorId.get(fila.packageId);
    if (!pkg) {
      noReversibles.push({ codigo: codigoMostrado, motivo: 'El paquete ya no existe.' });
      continue;
    }
    const historialPkg = historialPorPaquete.get(pkg.id) ?? [];
    const pagosPkg = pagosPorPaquete.get(pkg.id) ?? [];
    const pagoAjeno = pagosPkg.some((p) => p.importLogId !== importLogId);
    const pagoDeEsteLote = pagosPkg.find((p) => p.importLogId === importLogId);

    if (fila.estado === 'CREADO' || fila.estado === 'EN_DEPOSITO') {
      const estadoEsperado = fila.estado === 'CREADO' ? 'ENTREGADO' : 'EN_DEPOSITO';
      const historialAjeno = historialPkg.some((h) => h.importLogId !== importLogId);
      if (pkg.status !== estadoEsperado || pkg.origenEntrega !== 'IMPORTACION' || historialAjeno || pagoAjeno) {
        noReversibles.push({ codigo: pkg.code, motivo: 'El paquete fue modificado después de esta importación; eliminarlo perdería esos cambios.' });
        continue;
      }
      paraEliminar.push({ packageId: pkg.id });
    } else if (fila.estado === 'ENTREGADO') {
      if (pkg.status !== 'ENTREGADO' || pkg.origenEntrega !== 'IMPORTACION' || pagoAjeno) {
        noReversibles.push({ codigo: pkg.code, motivo: 'El paquete fue modificado después de esta importación (otro cobro, reingreso o corrección posterior).' });
        continue;
      }
      const ultimo = historialPkg[historialPkg.length - 1];
      if (!ultimo || ultimo.importLogId !== importLogId) {
        noReversibles.push({ codigo: pkg.code, motivo: 'El historial del paquete cambió después de esta importación.' });
        continue;
      }
      const previo = historialPkg[historialPkg.length - 2];
      if (!previo) {
        noReversibles.push({ codigo: pkg.code, motivo: 'No se pudo determinar a qué estado anterior debería volver.' });
        continue;
      }
      paraRevertirEntrega.push({ packageId: pkg.id, estadoAnterior: previo.estado, pagoId: pagoDeEsteLote?.id });
    } else if (fila.estado === 'SOLO_DATOS') {
      if (pagoAjeno && pagoDeEsteLote) {
        // Hay un pago de este lote Y otro ajeno posterior sobre el mismo
        // paquete: revertir a ciegas el de este lote podría descuadrar el
        // acumulado si el pago ajeno ya asumía este aplicado. Más seguro:
        // no tocar el dinero de este paquete (el texto tampoco se toca,
        // igual que cualquier SOLO_DATOS).
        noReversibles.push({ codigo: pkg.code, motivo: 'El paquete recibió otro cobro/ajuste después de esta importación; su pago no se revertirá.' });
        continue;
      }
      paraRevertirSoloDatos.push({ packageId: pkg.id, pagoId: pagoDeEsteLote?.id });
    }
  }

  return { paraEliminar, paraRevertirEntrega, paraRevertirSoloDatos, noReversibles };
}

/**
 * Revierte un lote de importación completo: elimina los paquetes que creó
 * (si nada los tocó después), repone el estado anterior de los paquetes
 * que solo marcó como entregados, y revierte el dinero (Pago) que generó —
 * todo dentro de UNA transacción (si algo falla a mitad de camino, Prisma
 * revierte todo; nunca queda el sistema parcialmente revertido, tal como
 * exige la especificación). El ImportLog/ImportRow nunca se borran: el
 * lote queda marcado revertidoAt/revertidoPorId, visible para siempre en
 * el historial como "revertido".
 */
export async function revertirLoteImportacion(id: string, userId: string): Promise<ResultadoReversion> {
  const log = await prisma.importLog.findUnique({ where: { id } });
  if (!log) throw new LoteNoEncontradoError(id);
  if (log.revertidoAt) throw new LoteYaRevertidoError(id);

  const plan = await planificarReversion(id);
  const totalConEfecto = plan.paraEliminar.length + plan.paraRevertirEntrega.length + plan.paraRevertirSoloDatos.length;
  if (totalConEfecto === 0 && plan.noReversibles.length === 0) throw new LoteSinEfectoParaRevertirError();

  const [company, feriados] = await Promise.all([getCompanyConfig(), getHolidaySet()]);
  const reglas = { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia };

  const resultado: ResultadoReversion = {
    paquetesEliminados: 0,
    entregasRevertidas: 0,
    pagosRevertidos: 0,
    actualizacionesNoRevertidas: 0,
    noReversibles: plan.noReversibles,
  };

  // El timeout escala con la cantidad de filas a revertir (mismo criterio
  // que TIMEOUT_BLOQUE_MS en la importación) pero acotado: una reversión
  // es una operación administrativa infrecuente sobre un lote típicamente
  // acotado (limpieza de pruebas), así que se prioriza atomicidad total
  // (una sola transacción, sin SAVEPOINT por fila) por sobre el mismo
  // particionado en bloques que usa la importación masiva.
  const timeoutMs = Math.min(180_000, Math.max(TRANSACTION_OPTS.timeout, totalConEfecto * 100));

  await prisma.$transaction(
    async (tx) => {
      for (const p of plan.paraEliminar) {
        await tx.package.delete({ where: { id: p.packageId } }); // cascada: Pago + PackageHistory de este paquete
        resultado.paquetesEliminados++;
      }

      for (const p of plan.paraRevertirEntrega) {
        await tx.package.update({ where: { id: p.packageId }, data: { status: p.estadoAnterior, entregaAt: null, origenEntrega: null } });
        await tx.packageHistory.create({
          data: { packageId: p.packageId, estado: p.estadoAnterior, fecha: new Date(), userId, nota: `Importación "${log.nombreLote ?? log.nombreArchivo}" revertida por un administrador.` },
        });
        if (p.pagoId) {
          const pago = await tx.pago.findUniqueOrThrow({ where: { id: p.pagoId } });
          const montoRevertido = pago.montoAnterior ?? 0;
          const pkgActual = await tx.package.findUniqueOrThrow({ where: { id: p.packageId } });
          const costoActual = calcularCosto(
            pkgActual.ingresoAt,
            fechaReferencia(pkgActual),
            reglas,
            feriados,
            pkgActual.tarifaBaseOverride,
            pkgActual.diasIncluidosOverride
          ).total;
          const estadoPago: PaymentStatus = montoRevertido <= 0 ? 'PENDIENTE' : montoRevertido >= costoActual ? 'PAGADO' : 'PARCIAL';
          await tx.package.update({ where: { id: p.packageId }, data: { montoPagado: montoRevertido, estadoPago } });
          await tx.pago.delete({ where: { id: p.pagoId } });
          resultado.pagosRevertidos++;
        }
        resultado.entregasRevertidas++;
      }

      for (const p of plan.paraRevertirSoloDatos) {
        if (p.pagoId) {
          const pago = await tx.pago.findUniqueOrThrow({ where: { id: p.pagoId } });
          const montoRevertido = pago.montoAnterior ?? 0;
          const pkgActual = await tx.package.findUniqueOrThrow({ where: { id: p.packageId } });
          const costoActual = calcularCosto(
            pkgActual.ingresoAt,
            fechaReferencia(pkgActual),
            reglas,
            feriados,
            pkgActual.tarifaBaseOverride,
            pkgActual.diasIncluidosOverride
          ).total;
          const estadoPago: PaymentStatus = montoRevertido <= 0 ? 'PENDIENTE' : montoRevertido >= costoActual ? 'PAGADO' : 'PARCIAL';
          await tx.package.update({ where: { id: p.packageId }, data: { montoPagado: montoRevertido, estadoPago } });
          await tx.pago.delete({ where: { id: p.pagoId } });
          resultado.pagosRevertidos++;
        }
        // El nombre/celular sobrescrito por SOLO_DATOS nunca se restaura —
        // ver comentario de cabecera de esta sección ("nunca inventar una
        // restauración"): no existe ningún registro del valor anterior.
        resultado.actualizacionesNoRevertidas++;
      }

      await tx.importLog.update({ where: { id }, data: { revertidoAt: new Date(), revertidoPorId: userId } });
    },
    { maxWait: TRANSACTION_OPTS.maxWait, timeout: timeoutMs }
  );

  await registrarAuditoria({
    userId,
    accion: 'IMPORTACION_LOTE_REVERTIDO',
    modulo: 'importacion',
    valorAnterior: { id, nombreArchivo: log.nombreArchivo, nombreLote: log.nombreLote },
    valorNuevo: {
      paquetesEliminados: resultado.paquetesEliminados,
      entregasRevertidas: resultado.entregasRevertidas,
      pagosRevertidos: resultado.pagosRevertidos,
      actualizacionesNoRevertidas: resultado.actualizacionesNoRevertidas,
      noReversibles: resultado.noReversibles.length,
    },
  });

  return resultado;
}
