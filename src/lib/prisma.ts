// src/lib/prisma.ts
// Patron singleton recomendado por Prisma para Next.js: evita crear una
// nueva conexion en cada hot-reload durante desarrollo.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// SQLite en modo rollback-journal (el default) serializa TODAS las
// escrituras con un unico lock exclusivo de archivo: bajo rafagas de
// escaneos verdaderamente simultaneos (varios lectores a la vez, ej.
// Recepcion + Deposito en el mismo instante) esto puede agotar el tiempo
// de espera de una transaccion y devolver un error 500 en vez de
// encolarse. WAL (Write-Ahead Logging) es el modo recomendado por SQLite
// para esta carga: permite que lecturas y escrituras no se bloqueen entre
// si y reduce drasticamente la contencion. Se activa una sola vez: queda
// grabado en el propio archivo de la base de datos, no hace falta
// repetirlo en cada arranque, pero ejecutarlo de nuevo es inofensivo.
// "PRAGMA journal_mode = WAL" devuelve una fila con el modo resultante
// (asi es como SQLite confirma el cambio), y $executeRawUnsafe esta
// pensado para sentencias que NO devuelven resultados — usarlo aqui
// fallaba en cada arranque con "Execute returned results, which is not
// allowed in SQLite" y WAL nunca quedaba activo pese a no verse un error
// visible en superficie. $queryRawUnsafe si acepta resultados; ademas se
// verifica el valor devuelto en vez de asumir exito solo por no lanzar.
if (!globalForPrisma.prisma) {
  prisma
    .$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode = WAL;')
    .then((filas) => {
      const modo = filas[0]?.journal_mode;
      if (modo?.toLowerCase() !== 'wal') {
        console.error(`WAL no quedó activo en SQLite (modo actual reportado: "${modo}").`);
      } else {
        console.log('SQLite en modo WAL.');
      }
    })
    .catch((err) => console.error('No se pudo activar WAL en SQLite:', err));
}

/**
 * Opciones para prisma.$transaction() en los caminos de escritura mas
 * concurridos (escaneo de Recepcion, transiciones de estado de Entrega/
 * Deposito). Los valores por defecto de Prisma (maxWait 2s, timeout 5s)
 * alcanzan de sobra para un solo lector escaneando en secuencia, pero se
 * quedan cortos si varios lectores escriben al mismo tiempo sobre SQLite
 * (un solo escritor a la vez, incluso en WAL) — medido en pruebas de
 * carga reales de esta sesion (20 escaneos verdaderamente simultaneos
 * agotaban el timeout por defecto). Subirlo no ralentiza el caso normal
 * (un $transaction que ya termino en 30ms sigue terminando en 30ms);
 * solo evita fallar de mas bajo una rafaga real.
 */
export const TRANSACTION_OPTS = { maxWait: 10_000, timeout: 10_000 } as const;
