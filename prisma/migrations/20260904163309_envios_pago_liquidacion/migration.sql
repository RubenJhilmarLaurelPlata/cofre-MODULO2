-- CreateTable
CREATE TABLE "LiquidacionEnvio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "destinoId" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "userId" TEXT,
    "notas" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiquidacionEnvio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "SucursalDestino" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LiquidacionEnvio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Envio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "qrToken" TEXT,
    "creadoPorId" TEXT,
    "cerradoPorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cerradoAt" DATETIME,
    "liquidacionId" TEXT,
    CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "SucursalDestino" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionEnvio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Envio" ("cerradoAt", "cerradoPorId", "codigo", "creadoPorId", "createdAt", "destinoId", "estado", "id", "qrToken", "updatedAt") SELECT "cerradoAt", "cerradoPorId", "codigo", "creadoPorId", "createdAt", "destinoId", "estado", "id", "qrToken", "updatedAt" FROM "Envio";
DROP TABLE "Envio";
ALTER TABLE "new_Envio" RENAME TO "Envio";
CREATE UNIQUE INDEX "Envio_codigo_key" ON "Envio"("codigo");
CREATE UNIQUE INDEX "Envio_qrToken_key" ON "Envio"("qrToken");
CREATE INDEX "Envio_destinoId_idx" ON "Envio"("destinoId");
CREATE INDEX "Envio_estado_idx" ON "Envio"("estado");
CREATE INDEX "Envio_createdAt_idx" ON "Envio"("createdAt");
CREATE INDEX "Envio_liquidacionId_idx" ON "Envio"("liquidacionId");
CREATE TABLE "new_EnvioItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "envioId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "estadoPago" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "montoPagado" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnvioItem_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnvioItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EnvioItem" ("createdAt", "envioId", "id", "packageId") SELECT "createdAt", "envioId", "id", "packageId" FROM "EnvioItem";
DROP TABLE "EnvioItem";
ALTER TABLE "new_EnvioItem" RENAME TO "EnvioItem";
CREATE INDEX "EnvioItem_packageId_idx" ON "EnvioItem"("packageId");
CREATE INDEX "EnvioItem_envioId_idx" ON "EnvioItem"("envioId");
CREATE UNIQUE INDEX "EnvioItem_envioId_packageId_key" ON "EnvioItem"("envioId", "packageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LiquidacionEnvio_destinoId_idx" ON "LiquidacionEnvio"("destinoId");

-- CreateIndex
CREATE INDEX "LiquidacionEnvio_createdAt_idx" ON "LiquidacionEnvio"("createdAt");
