-- Fase 5.3C: cola local persistente ("outbox") de eventos pendientes de
-- enviar al servicio independiente de tracking (cofre-tracking, Fase 5.2).
-- Migracion 100% aditiva: solo crea una tabla nueva, no toca ninguna
-- columna ni fila existente de ninguna otra tabla.
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "origenSucursalCodigo" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDING',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "lastError" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_eventId_key" ON "OutboxEvent"("eventId");

-- CreateIndex
CREATE INDEX "OutboxEvent_estado_nextAttemptAt_idx" ON "OutboxEvent"("estado", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_tipoEvento_idx" ON "OutboxEvent"("tipoEvento");
