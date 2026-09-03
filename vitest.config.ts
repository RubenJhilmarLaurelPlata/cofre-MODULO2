import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Config minima para tests de integracion contra SQLite real (ver
// tests/setup.ts para el detalle de por que NO se usa mocks: la
// correccion que se esta probando es justamente el comportamiento real de
// Prisma/SQLite bajo la arquitectura de bloques+SAVEPOINT). fileParallelism
// en false porque todos los tests de importacion viven en un unico
// archivo que comparte una misma base de datos de prueba — no hace falta
// paralelizar procesos para esto y evita cualquier condicion de carrera
// sobre el mismo archivo .db.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
