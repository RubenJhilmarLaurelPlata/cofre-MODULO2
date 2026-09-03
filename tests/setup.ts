// tests/setup.ts
// Base de datos de PRUEBA, aislada de dev.db (que en este proyecto tiene
// datos reales — ver auditoría, dev.db ya contiene paquetes/pagos reales
// de producción/pruebas manuales). Nunca debe apuntar a dev.db: se crea un
// archivo SQLite nuevo, se le aplica el schema completo con
// `prisma db push --force-reset`, y se destruye al terminar.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

// src/lib/config.ts envuelve getCompanyConfig()/getHolidaySet() con
// `cache()` de 'react' — memoización por request de Next (React Server
// Components), que solo existe dentro del runtime de Next. Fuera de Next
// (este test runner) React expone `cache` como no-función y la llamada
// revienta con "cache is not a function". Se reemplaza aquí por un
// identity wrapper: el comportamiento real de getCompanyConfig/
// getHolidaySet (leer o crear la fila de Company, leer feriados) es
// exactamente el mismo con o sin memoización — la memoización es solo una
// optimización de performance dentro de una misma request HTTP, nunca
// parte de la lógica de negocio que estas pruebas verifican.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: (fn: unknown) => fn };
});

const testDbPath = path.resolve(__dirname, '../prisma/test.db');
const testDbUrl = `file:${testDbPath}?connection_limit=1`;

process.env.DATABASE_URL = testDbUrl;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-solo-para-pruebas';

for (const sufijo of ['', '-journal', '-wal', '-shm']) {
  const p = testDbPath + sufijo;
  if (existsSync(p)) rmSync(p);
}

execSync('npx prisma db push --skip-generate --force-reset --schema=./prisma/schema.prisma', {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: testDbUrl },
  stdio: 'inherit',
});
