-- Fase 5.3-HARDENING: agrega "claimedAt" (lease de SENDING, recuperacion
-- de workers muertos) y "destino" (TRACKING | INTEROP_ORIGEN, para la
-- delegacion de eventos post-interop) a OutboxEvent. SQLite reconstruye
-- la tabla para agregar columnas (limitacion conocida de ALTER TABLE en
-- SQLite con multiples columnas nuevas) pero preserva todas las filas
-- existentes via el INSERT...SELECT de abajo — no toca ninguna otra
-- tabla ni columna del sistema.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "destino" TEXT NOT NULL DEFAULT 'TRACKING',
    "tipoEvento" TEXT NOT NULL,
    "origenSucursalCodigo" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" DATETIME,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "lastError" TEXT
);
INSERT INTO "new_OutboxEvent" ("createdAt", "estado", "eventId", "id", "intentos", "lastError", "nextAttemptAt", "origenSucursalCodigo", "payload", "sentAt", "tipoEvento") SELECT "createdAt", "estado", "eventId", "id", "intentos", "lastError", "nextAttemptAt", "origenSucursalCodigo", "payload", "sentAt", "tipoEvento" FROM "OutboxEvent";
DROP TABLE "OutboxEvent";
ALTER TABLE "new_OutboxEvent" RENAME TO "OutboxEvent";
CREATE UNIQUE INDEX "OutboxEvent_eventId_key" ON "OutboxEvent"("eventId");
CREATE INDEX "OutboxEvent_estado_nextAttemptAt_idx" ON "OutboxEvent"("estado", "nextAttemptAt");
CREATE INDEX "OutboxEvent_estado_claimedAt_idx" ON "OutboxEvent"("estado", "claimedAt");
CREATE INDEX "OutboxEvent_tipoEvento_idx" ON "OutboxEvent"("tipoEvento");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

