// src/lib/respaldos.ts
// Respaldo completo de la base de datos (Modulo 7): como el motor es
// SQLite, un respaldo es una copia exacta del archivo .db. Se guarda en
// "data/backups/" (ya contemplado en .gitignore), fuera de "public/" para
// que nunca sea accesible por URL directa — solo se descarga a traves
// del endpoint que verifica sesion de administrador.
//
// Deja preparada la arquitectura para una futura restauracion automatica
// (el nombre exacto de archivo de cada respaldo queda guardado en la
// tabla Backup), pero esa restauracion todavia no esta implementada.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';

const CARPETA_RESPALDOS = path.join(process.cwd(), 'data', 'backups');

/**
 * Timestamp para nombres de archivo de respaldo, en hora America/La_Paz
 * (el proceso Node ya esta anclado a esa TZ — ver next.config.mjs, igual
 * que dateKey() en src/lib/pricing.ts) en vez de .toISOString() (que
 * siempre da UTC sin importar la TZ del proceso): evita que un respaldo
 * hecho, por ejemplo, a las 21:00 hora Bolivia (01:00 UTC del día
 * siguiente) quede con el nombre de un día que todavía no es "hoy" aquí.
 * Se reutiliza también en backup-oracle.ts (restaurarDesdeOracle) para
 * que ambos subsistemas de respaldo nombren sus archivos igual.
 */
export function timestampArchivoLocal(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}

function rutaBaseDeDatos(): string {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  const archivo = url.replace(/^file:/, '');
  // Prisma resuelve las rutas "file:" relativas a la carpeta prisma/.
  return path.isAbsolute(archivo) ? archivo : path.join(process.cwd(), 'prisma', archivo);
}

export interface RespaldoDTO {
  id: string;
  nombreArchivo: string;
  tamanioBytes: number;
  estado: string;
  usuario: string;
  createdAt: string;
}

function toRespaldoDTO(b: { id: string; nombreArchivo: string; tamanioBytes: number; estado: string; createdAt: Date; user: { nombre: string } | null }): RespaldoDTO {
  return {
    id: b.id,
    nombreArchivo: b.nombreArchivo,
    tamanioBytes: b.tamanioBytes,
    estado: b.estado,
    usuario: b.user?.nombre ?? 'Sistema',
    createdAt: b.createdAt.toISOString(),
  };
}

export async function listarRespaldos(): Promise<RespaldoDTO[]> {
  const respaldos = await prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { nombre: true } } },
  });
  return respaldos.map(toRespaldoDTO);
}

export async function crearRespaldo(userId: string): Promise<RespaldoDTO> {
  await mkdir(CARPETA_RESPALDOS, { recursive: true });

  const nombreArchivo = `cofre-express-${timestampArchivoLocal()}.db`;
  const destino = path.join(CARPETA_RESPALDOS, nombreArchivo);

  let estado = 'COMPLETADO';
  let tamanioBytes = 0;
  try {
    const contenido = await readFile(rutaBaseDeDatos());
    await writeFile(destino, contenido);
    tamanioBytes = (await stat(destino)).size;
  } catch (err) {
    console.error('Error creando respaldo:', err);
    estado = 'ERROR';
  }

  const registro = await prisma.backup.create({
    data: { nombreArchivo, tamanioBytes, estado, userId },
    include: { user: { select: { nombre: true } } },
  });

  return toRespaldoDTO(registro);
}

export async function obtenerArchivoRespaldo(id: string): Promise<{ buffer: Buffer; nombreArchivo: string } | null> {
  const registro = await prisma.backup.findUnique({ where: { id } });
  if (!registro || registro.estado !== 'COMPLETADO') return null;

  const ruta = path.join(CARPETA_RESPALDOS, registro.nombreArchivo);
  try {
    const buffer = await readFile(ruta);
    return { buffer, nombreArchivo: registro.nombreArchivo };
  } catch {
    return null;
  }
}
