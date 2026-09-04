-- Fase 1 (arquitectura multi-sucursal): identidad de esta instalacion.
-- Estrictamente aditiva -- 5 columnas nuevas, todas nullable, sin tocar
-- ninguna columna existente de Company. Ver prisma/schema.prisma para el
-- razonamiento completo de por que ciudad/telefono/horarioAtencion NO se
-- duplican aqui.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "googleMapsUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN "sucursalCodigo" TEXT;
ALTER TABLE "Company" ADD COLUMN "sucursalNombre" TEXT;
ALTER TABLE "Company" ADD COLUMN "tiktokUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN "whatsapp" TEXT;

-- Identidad conocida y explicita de la instalacion actual (La Paz) -- no
-- se inventa ningun valor: sucursalCodigo/sucursalNombre son los unicos
-- dos datos nuevos que el dueño del producto proveyo directamente. Google
-- Maps/TikTok/WhatsApp quedan NULL (nunca inventados). "ciudad" no se
-- toca: ya vale 'La Paz' en la fila existente. Esta sentencia es
-- idempotente en la practica: en una instalacion nueva (ej. El Alto) la
-- fila Company con id=1 todavia no existe en este punto (la crea
-- getCompanyConfig() en el primer acceso), asi que este UPDATE no
-- encuentra filas y no hace nada -- la identidad de esa instalacion se
-- configura despues, desde la pantalla de Configuracion > Empresa.
UPDATE "Company" SET "sucursalCodigo" = 'LPZ', "sucursalNombre" = 'Cofre Express La Paz' WHERE "id" = 1;
