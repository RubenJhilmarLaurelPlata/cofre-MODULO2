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

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `cofre-express-${timestamp}.db`;
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
