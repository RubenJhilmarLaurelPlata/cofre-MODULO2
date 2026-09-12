-- Fase 4.4 (cierre del punto pendiente de la auditoria de Fase 4): agrega
-- "Envio.recibidoViaInterop" (Boolean, NOT NULL, default false) para
-- distinguir una recepcion LOCAL (sesion de un usuario de esta
-- instalacion, "Envios -> Recibir envio") de una recepcion REMOTA
-- (disparada por otra instalacion via
-- POST /api/interop/envios/[codigo]/recibir). No cambia el significado
-- de "estado" ni agrega ningun estado nuevo — sigue siendo el mismo
-- "RECIBIDO" de siempre, solo que ahora se sabe COMO se llego ahi.
--
-- Migracion 100% aditiva y segura para datos existentes: SQLite no
-- soporta agregar una columna NOT NULL con un valor constante por
-- default via un ALTER TABLE simple de forma confiable en todas las
-- versiones, asi que Prisma reconstruye la tabla (mismo patron ya usado
-- y ya aplicado en produccion en la migracion
-- 20260904163309_envios_pago_liquidacion) — TODAS las columnas y TODAS
-- las filas existentes de "Envio" se preservan exactamente igual via el
-- INSERT...SELECT; ningun dato se pierde, ninguna fila se borra. Todo
-- envio ya existente (recibido o no) queda con recibidoViaInterop=false
-- por defecto — correcto: nunca hubo comunicacion real entre
-- instalaciones antes de esta fase, asi que ningun RECIBIDO anterior fue
-- ni pudo haber sido remoto.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Envio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "qrToken" TEXT,
    "transferenciaId" TEXT,
    "recibidoViaInterop" BOOLEAN NOT NULL DEFAULT false,
    "creadoPorId" TEXT,
    "cerradoPorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cerradoAt" DATETIME,
    "liquidacionId" TEXT,
    "diaAperturaKey" TEXT,
    CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "SucursalDestino" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionEnvio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Envio" ("cerradoAt", "cerradoPorId", "codigo", "creadoPorId", "createdAt", "destinoId", "diaAperturaKey", "estado", "id", "liquidacionId", "qrToken", "transferenciaId", "updatedAt") SELECT "cerradoAt", "cerradoPorId", "codigo", "creadoPorId", "createdAt", "destinoId", "diaAperturaKey", "estado", "id", "liquidacionId", "qrToken", "transferenciaId", "updatedAt" FROM "Envio";
DROP TABLE "Envio";
ALTER TABLE "new_Envio" RENAME TO "Envio";
CREATE UNIQUE INDEX "Envio_codigo_key" ON "Envio"("codigo");
CREATE UNIQUE INDEX "Envio_qrToken_key" ON "Envio"("qrToken");
CREATE UNIQUE INDEX "Envio_transferenciaId_key" ON "Envio"("transferenciaId");
CREATE INDEX "Envio_destinoId_idx" ON "Envio"("destinoId");
CREATE INDEX "Envio_estado_idx" ON "Envio"("estado");
CREATE INDEX "Envio_createdAt_idx" ON "Envio"("createdAt");
CREATE INDEX "Envio_liquidacionId_idx" ON "Envio"("liquidacionId");
CREATE UNIQUE INDEX "Envio_destinoId_diaAperturaKey_key" ON "Envio"("destinoId", "diaAperturaKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
