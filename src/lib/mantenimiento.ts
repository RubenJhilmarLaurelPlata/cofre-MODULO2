// src/lib/mantenimiento.ts
// Pantalla de solo lectura (Modulo 7): informacion real del sistema, sin
// ninguna accion peligrosa disponible desde aqui.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import packageJson from '../../package.json';
import nextPackageJson from 'next/package.json';
import prismaClientPackageJson from '@prisma/client/package.json';

function rutaBaseDeDatos(): string {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  const archivo = url.replace(/^file:/, '');
  return path.isAbsolute(archivo) ? archivo : path.join(process.cwd(), 'prisma', archivo);
}

export interface InfoMantenimiento {
  versionSistema: string;
  versionNext: string;
  versionPrisma: string;
  baseDeDatosConectada: boolean;
  espacioBaseDeDatosBytes: number | null;
  registros: {
    paquetes: number;
    usuarios: number;
    historialPaquetes: number;
    lotesEtiquetas: number;
    codigosGenerados: number;
    auditoria: number;
  };
  ultimoRespaldo: string | null;
  ultimaOptimizacion: string | null;
}

export async function getInfoMantenimiento(): Promise<InfoMantenimiento> {
  let baseDeDatosConectada = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    baseDeDatosConectada = false;
  }

  const [paquetes, usuarios, historialPaquetes, lotesEtiquetas, codigosGenerados, auditoria, ultimoRespaldo] = await Promise.all([
    prisma.package.count().catch(() => 0),
    prisma.user.count().catch(() => 0),
    prisma.packageHistory.count().catch(() => 0),
    prisma.labelBatch.count().catch(() => 0),
    prisma.generatedCode.count().catch(() => 0),
    prisma.auditLog.count().catch(() => 0),
    prisma.backup.findFirst({ where: { estado: 'COMPLETADO' }, orderBy: { createdAt: 'desc' } }).catch(() => null),
  ]);

  let espacioBaseDeDatosBytes: number | null = null;
  try {
    espacioBaseDeDatosBytes = (await stat(rutaBaseDeDatos())).size;
  } catch {
    espacioBaseDeDatosBytes = null;
  }

  return {
    versionSistema: packageJson.version,
    versionNext: nextPackageJson.version,
    versionPrisma: prismaClientPackageJson.version,
    baseDeDatosConectada,
    espacioBaseDeDatosBytes,
    registros: { paquetes, usuarios, historialPaquetes, lotesEtiquetas, codigosGenerados, auditoria },
    ultimoRespaldo: ultimoRespaldo?.createdAt.toISOString() ?? null,
    ultimaOptimizacion: null,
  };
}
