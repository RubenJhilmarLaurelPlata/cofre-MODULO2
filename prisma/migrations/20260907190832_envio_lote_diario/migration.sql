-- AlterTable
ALTER TABLE "Envio" ADD COLUMN "diaAperturaKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Envio_destinoId_diaAperturaKey_key" ON "Envio"("destinoId", "diaAperturaKey");
