-- Fase 4.1 (preparacion de esquema para comunicacion segura entre
-- instalaciones — La Paz / El Alto / futuras). Migracion 100% aditiva:
-- solo agrega columnas nullable, un indice unico nuevo y una tabla
-- nueva. No borra ni renombra ninguna columna/tabla existente, no toca
-- ningun dato existente. Segura de aplicar sobre una base nueva, sobre
-- la base actual de La Paz y sobre la base actual de El Alto.
--
-- Ningun endpoint ni funcion de src/lib usa estos campos todavia (ver
-- comentarios de cada campo en prisma/schema.prisma) — esta migracion
-- solo deja el terreno preparado para la Fase 4.2 (endpoints
-- /api/interop, firma HMAC, llamadas HTTP reales), sin cambiar en
-- absoluto el comportamiento actual de Envios/Recepcion.

-- AlterTable: credenciales (opcionales) para comunicarse con la
-- instalacion externa que representa cada destino.
ALTER TABLE "SucursalDestino" ADD COLUMN "apiUrlSaliente" TEXT;
ALTER TABLE "SucursalDestino" ADD COLUMN "apiKeySaliente" TEXT;
ALTER TABLE "SucursalDestino" ADD COLUMN "apiKeyEntrante" TEXT;

-- AlterTable: identidad tecnica y estable de la transferencia, separada
-- de "codigo" (visible) y "qrToken" (secreto de un solo proposito).
ALTER TABLE "Envio" ADD COLUMN "transferenciaId" TEXT;

-- CreateIndex: unica, pero nullable — SQLite trata cada NULL como
-- distinto entre si, asi que todos los envios existentes (que quedan en
-- NULL) conviven sin problema con este indice (mismo patron ya usado en
-- la migracion de "diaAperturaKey").
CREATE UNIQUE INDEX "Envio_transferenciaId_key" ON "Envio"("transferenciaId");

-- AlterTable: de donde vino un paquete materializado por una
-- transferencia entre instalaciones (todos NULL para cualquier paquete
-- registrado normalmente por Recepcion/Envios de esta instalacion, es
-- decir el 100% de los paquetes existentes hoy).
ALTER TABLE "Package" ADD COLUMN "origenSucursalCodigo" TEXT;
ALTER TABLE "Package" ADD COLUMN "origenCodigoPaquete" TEXT;
ALTER TABLE "Package" ADD COLUMN "origenTransferenciaId" TEXT;

-- CreateIndex
CREATE INDEX "Package_origenTransferenciaId_idx" ON "Package"("origenTransferenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_origenSucursalCodigo_origenCodigoPaquete_key" ON "Package"("origenSucursalCodigo", "origenCodigoPaquete");

-- CreateTable: registro de idempotencia de la recepcion REMOTA de una
-- transferencia (ver comentario del modelo en schema.prisma). Un solo
-- proposito, no un sistema de eventos generico.
CREATE TABLE "EnvioRecepcionRemota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferenciaId" TEXT NOT NULL,
    "origenCodigo" TEXT NOT NULL,
    "envioCodigoOrigen" TEXT NOT NULL,
    "cantidadPaquetes" INTEGER NOT NULL DEFAULT 0,
    "recibidoAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioRecepcionRemota_transferenciaId_key" ON "EnvioRecepcionRemota"("transferenciaId");

-- CreateIndex
CREATE INDEX "EnvioRecepcionRemota_origenCodigo_idx" ON "EnvioRecepcionRemota"("origenCodigo");

-- CreateIndex
CREATE INDEX "EnvioRecepcionRemota_recibidoAt_idx" ON "EnvioRecepcionRemota"("recibidoAt");
