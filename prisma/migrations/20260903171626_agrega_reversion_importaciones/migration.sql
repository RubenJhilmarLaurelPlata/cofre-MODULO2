-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombreArchivo" TEXT NOT NULL,
    "nombreLote" TEXT,
    "formato" TEXT NOT NULL,
    "tipoImportacion" TEXT NOT NULL DEFAULT 'MARCAR_ENTREGADOS',
    "detectados" INTEGER NOT NULL,
    "validos" INTEGER NOT NULL,
    "duplicados" INTEGER NOT NULL,
    "invalidos" INTEGER NOT NULL,
    "marcadosEntregado" INTEGER NOT NULL DEFAULT 0,
    "noEncontrados" INTEGER NOT NULL DEFAULT 0,
    "creadosFaltantes" INTEGER NOT NULL DEFAULT 0,
    "detalleErrores" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertidoAt" DATETIME,
    "revertidoPorId" TEXT,
    CONSTRAINT "ImportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportLog_revertidoPorId_fkey" FOREIGN KEY ("revertidoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ImportLog" ("creadosFaltantes", "createdAt", "detalleErrores", "detectados", "duplicados", "formato", "id", "invalidos", "marcadosEntregado", "noEncontrados", "nombreArchivo", "nombreLote", "tipoImportacion", "userId", "validos") SELECT "creadosFaltantes", "createdAt", "detalleErrores", "detectados", "duplicados", "formato", "id", "invalidos", "marcadosEntregado", "noEncontrados", "nombreArchivo", "nombreLote", "tipoImportacion", "userId", "validos" FROM "ImportLog";
DROP TABLE "ImportLog";
ALTER TABLE "new_ImportLog" RENAME TO "ImportLog";
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");
CREATE TABLE "new_Pago" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "montoAnterior" REAL,
    "montoNuevo" REAL,
    "motivo" TEXT,
    "userId" TEXT,
    "importLogId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pago_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pago_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Pago_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Pago" ("createdAt", "id", "monto", "montoAnterior", "montoNuevo", "motivo", "packageId", "tipo", "userId") SELECT "createdAt", "id", "monto", "montoAnterior", "montoNuevo", "motivo", "packageId", "tipo", "userId" FROM "Pago";
DROP TABLE "Pago";
ALTER TABLE "new_Pago" RENAME TO "Pago";
CREATE INDEX "Pago_packageId_idx" ON "Pago"("packageId");
CREATE INDEX "Pago_tipo_idx" ON "Pago"("tipo");
CREATE INDEX "Pago_createdAt_idx" ON "Pago"("createdAt");
CREATE INDEX "Pago_importLogId_idx" ON "Pago"("importLogId");
CREATE TABLE "new_PackageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "nota" TEXT,
    "importLogId" TEXT,
    CONSTRAINT "PackageHistory_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PackageHistory_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PackageHistory" ("estado", "fecha", "id", "nota", "packageId", "userId") SELECT "estado", "fecha", "id", "nota", "packageId", "userId" FROM "PackageHistory";
DROP TABLE "PackageHistory";
ALTER TABLE "new_PackageHistory" RENAME TO "PackageHistory";
CREATE INDEX "PackageHistory_packageId_idx" ON "PackageHistory"("packageId");
CREATE INDEX "PackageHistory_fecha_idx" ON "PackageHistory"("fecha");
CREATE INDEX "PackageHistory_userId_idx" ON "PackageHistory"("userId");
CREATE INDEX "PackageHistory_importLogId_idx" ON "PackageHistory"("importLogId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

