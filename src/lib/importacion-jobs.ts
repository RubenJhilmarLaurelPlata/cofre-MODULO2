// src/lib/importacion-jobs.ts
// Registro en memoria del progreso de una importacion en curso, para que
// el frontend pueda mostrar "procesando fila N de TOTAL" en vivo por SSE
// (ver src/app/api/importacion/progreso/[jobId]/route.ts) sin depender de
// mantener abierta la peticion HTTP que dispara la importacion (esa es
// justamente la causa de un 504 con archivos grandes — ver auditoria,
// "No quiero errores 504 por diseño").
//
// Por que en memoria y no en la base de datos: este proyecto corre como
// un unico proceso Node de larga duracion (`next start`, no funciones
// serverless efimeras — ver src/lib/prisma.ts, mismo supuesto que ya usa
// connection_limit=1), asi que un Map a nivel de modulo sobrevive
// perfectamente entre la peticion que crea el job y las peticiones SSE
// que lo consultan. El resultado FINAL de la importacion (Package/Pago/
// PackageHistory/ImportLog/ImportRow) siempre se persiste en la base de
// datos como siempre — este registro es solo progreso transitorio de UI;
// perderlo (ej. si el proceso se reinicia a mitad de un import) nunca deja
// datos corruptos, solo un jobId que el cliente ya no puede seguir viendo
// avanzar (se reporta como error de conexion, no como dato perdido).
//
// Mismo patron que el singleton de Prisma: se guarda en globalThis para
// sobrevivir al hot-reload de `next dev` (si no, cada recompilacion crea
// un Map nuevo y un job en curso "desaparece" para el cliente que ya tenia
// el EventSource abierto).

export type EstadoJob = 'procesando' | 'completado' | 'error';

export interface FilaActualJob {
  numeroFila: number;
  codigo: string;
  accion: string; // "Creando paquete...", "Marcando entregado...", "Actualizando datos...", etc.
}

export interface ImportJobEstado {
  id: string;
  total: number;
  procesados: number;
  errores: number;
  actual: FilaActualJob | null;
  estado: EstadoJob;
  // Solo se llenan cuando estado === 'completado' | 'error'.
  resultado?: unknown;
  importLogId?: string;
  errorMensaje?: string;
  creadoAt: number;
  actualizadoAt: number;
}

const globalForJobs = globalThis as unknown as { importJobs?: Map<string, ImportJobEstado> };
const jobs = globalForJobs.importJobs ?? new Map<string, ImportJobEstado>();
if (!globalForJobs.importJobs) globalForJobs.importJobs = jobs;

// Un job completado/con error se limpia solo despues de este margen —
// tiempo de sobra para que el cliente (que puede haber tenido un corte de
// red justo al final) reabra el EventSource y todavia encuentre el
// resultado final, sin dejar jobs viejos acumulandose para siempre en
// memoria en un servidor de larga duracion.
const TTL_JOB_TERMINADO_MS = 5 * 60_000;

export function crearJob(id: string, total: number): ImportJobEstado {
  const job: ImportJobEstado = {
    id,
    total,
    procesados: 0,
    errores: 0,
    actual: null,
    estado: 'procesando',
    creadoAt: Date.now(),
    actualizadoAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function actualizarProgresoJob(id: string, actual: FilaActualJob, huboError: boolean): void {
  const job = jobs.get(id);
  if (!job) return;
  job.procesados += 1;
  if (huboError) job.errores += 1;
  job.actual = actual;
  job.actualizadoAt = Date.now();
}

export function completarJob(id: string, resultado: unknown, importLogId: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.estado = 'completado';
  job.resultado = resultado;
  job.importLogId = importLogId;
  job.actualizadoAt = Date.now();
  setTimeout(() => jobs.delete(id), TTL_JOB_TERMINADO_MS).unref?.();
}

export function marcarErrorJob(id: string, mensaje: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.estado = 'error';
  job.errorMensaje = mensaje;
  job.actualizadoAt = Date.now();
  setTimeout(() => jobs.delete(id), TTL_JOB_TERMINADO_MS).unref?.();
}

export function obtenerJob(id: string): ImportJobEstado | undefined {
  return jobs.get(id);
}
