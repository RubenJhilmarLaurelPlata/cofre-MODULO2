-- Fase 2: modulo Envios (transferencias locales entre instalaciones,
-- sin comunicacion entre servidores todavia) + sistema de permisos
-- granular con asignacion rol->permiso persistida (RolePermiso), en vez
-- de un Record hardcodeado en TypeScript.
--
-- Estrictamente aditiva: 2 columnas nuevas nullable en User, 4 tablas
-- nuevas. Ninguna columna existente se toca, ningun DROP, ningun RENAME.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "permisosExtra" TEXT;
ALTER TABLE "User" ADD COLUMN "permisosRevocados" TEXT;

-- CreateTable
CREATE TABLE "SucursalDestino" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ciudad" TEXT,
    "direccion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Envio" (
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
    CONSTRAINT "Envio_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "SucursalDestino" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envio_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envio_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnvioItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "envioId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnvioItem_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "Envio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnvioItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RolePermiso" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "permiso" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SucursalDestino_codigo_key" ON "SucursalDestino"("codigo");

-- CreateIndex
CREATE INDEX "SucursalDestino_activa_idx" ON "SucursalDestino"("activa");

-- CreateIndex
CREATE UNIQUE INDEX "Envio_codigo_key" ON "Envio"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Envio_qrToken_key" ON "Envio"("qrToken");

-- CreateIndex
CREATE INDEX "Envio_destinoId_idx" ON "Envio"("destinoId");

-- CreateIndex
CREATE INDEX "Envio_estado_idx" ON "Envio"("estado");

-- CreateIndex
CREATE INDEX "Envio_createdAt_idx" ON "Envio"("createdAt");

-- CreateIndex
CREATE INDEX "EnvioItem_packageId_idx" ON "EnvioItem"("packageId");

-- CreateIndex
CREATE INDEX "EnvioItem_envioId_idx" ON "EnvioItem"("envioId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioItem_envioId_packageId_key" ON "EnvioItem"("envioId", "packageId");

-- CreateIndex
CREATE INDEX "RolePermiso_role_idx" ON "RolePermiso"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermiso_role_permiso_key" ON "RolePermiso"("role", "permiso");

-- Siembra de RolePermiso: reproduce EXACTAMENTE el acceso que cada rol ya
-- tiene hoy, auditado ruta por ruta (ver src/lib/permisos.ts para el
-- catalogo completo con nombre/descripcion). Ningun usuario pierde ni
-- gana acceso el dia de este despliegue -- las rutas ya migradas a
-- tienePermiso() leen esto y obtienen el mismo resultado que su antiguo
-- ROLES_PERMITIDOS; las que todavia no se migraron ni siquiera consultan
-- esta tabla. A partir de aqui, cualquier fila que un administrador
-- agregue/quite desde Configuracion > Roles y permisos es efectiva de
-- inmediato (RolePermiso es la fuente de verdad real, no este INSERT).
-- 103 filas.
INSERT INTO "RolePermiso" ("id", "role", "permiso") VALUES
('ADMIN:envios.ver', 'ADMIN', 'envios.ver'),
('RECEPCION:envios.ver', 'RECEPCION', 'envios.ver'),
('ADMIN_CAJA:envios.ver', 'ADMIN_CAJA', 'envios.ver'),
('ADMIN:envios.crear', 'ADMIN', 'envios.crear'),
('RECEPCION:envios.crear', 'RECEPCION', 'envios.crear'),
('ADMIN_CAJA:envios.crear', 'ADMIN_CAJA', 'envios.crear'),
('ADMIN:envios.agregar_paquete', 'ADMIN', 'envios.agregar_paquete'),
('RECEPCION:envios.agregar_paquete', 'RECEPCION', 'envios.agregar_paquete'),
('ADMIN_CAJA:envios.agregar_paquete', 'ADMIN_CAJA', 'envios.agregar_paquete'),
('ADMIN:envios.quitar_paquete', 'ADMIN', 'envios.quitar_paquete'),
('RECEPCION:envios.quitar_paquete', 'RECEPCION', 'envios.quitar_paquete'),
('ADMIN_CAJA:envios.quitar_paquete', 'ADMIN_CAJA', 'envios.quitar_paquete'),
('ADMIN:envios.cerrar', 'ADMIN', 'envios.cerrar'),
('RECEPCION:envios.cerrar', 'RECEPCION', 'envios.cerrar'),
('ADMIN_CAJA:envios.cerrar', 'ADMIN_CAJA', 'envios.cerrar'),
('ADMIN:envios.cancelar', 'ADMIN', 'envios.cancelar'),
('RECEPCION:envios.cancelar', 'RECEPCION', 'envios.cancelar'),
('ADMIN_CAJA:envios.cancelar', 'ADMIN_CAJA', 'envios.cancelar'),
('ADMIN:envios.ver_qr', 'ADMIN', 'envios.ver_qr'),
('RECEPCION:envios.ver_qr', 'RECEPCION', 'envios.ver_qr'),
('ADMIN_CAJA:envios.ver_qr', 'ADMIN_CAJA', 'envios.ver_qr'),
('ADMIN:transferencias.ver', 'ADMIN', 'transferencias.ver'),
('ADMIN:transferencias.escanear_qr', 'ADMIN', 'transferencias.escanear_qr'),
('ADMIN:transferencias.recibir', 'ADMIN', 'transferencias.recibir'),
('ADMIN:transferencias.confirmar', 'ADMIN', 'transferencias.confirmar'),
('ADMIN:recepcion.registrar', 'ADMIN', 'recepcion.registrar'),
('RECEPCION:recepcion.registrar', 'RECEPCION', 'recepcion.registrar'),
('ADMIN_CAJA:recepcion.registrar', 'ADMIN_CAJA', 'recepcion.registrar'),
('ADMIN:recepcion.ver', 'ADMIN', 'recepcion.ver'),
('RECEPCION:recepcion.ver', 'RECEPCION', 'recepcion.ver'),
('ADMIN_CAJA:recepcion.ver', 'ADMIN_CAJA', 'recepcion.ver'),
('ADMIN:deposito.enviar', 'ADMIN', 'deposito.enviar'),
('ENTREGA:deposito.enviar', 'ENTREGA', 'deposito.enviar'),
('RECEPCION:deposito.enviar', 'RECEPCION', 'deposito.enviar'),
('ADMIN_CAJA:deposito.enviar', 'ADMIN_CAJA', 'deposito.enviar'),
('ADMIN:deposito.bajar', 'ADMIN', 'deposito.bajar'),
('ENTREGA:deposito.bajar', 'ENTREGA', 'deposito.bajar'),
('RECEPCION:deposito.bajar', 'RECEPCION', 'deposito.bajar'),
('ADMIN_CAJA:deposito.bajar', 'ADMIN_CAJA', 'deposito.bajar'),
('ADMIN:deposito.ver_pendientes', 'ADMIN', 'deposito.ver_pendientes'),
('ENTREGA:deposito.ver_pendientes', 'ENTREGA', 'deposito.ver_pendientes'),
('RECEPCION:deposito.ver_pendientes', 'RECEPCION', 'deposito.ver_pendientes'),
('ADMIN_CAJA:deposito.ver_pendientes', 'ADMIN_CAJA', 'deposito.ver_pendientes'),
('ADMIN:entrega.buscar', 'ADMIN', 'entrega.buscar'),
('ENTREGA:entrega.buscar', 'ENTREGA', 'entrega.buscar'),
('ADMIN_CAJA:entrega.buscar', 'ADMIN_CAJA', 'entrega.buscar'),
('ADMIN:entrega.entregar', 'ADMIN', 'entrega.entregar'),
('ENTREGA:entrega.entregar', 'ENTREGA', 'entrega.entregar'),
('ADMIN_CAJA:entrega.entregar', 'ADMIN_CAJA', 'entrega.entregar'),
('ADMIN:entrega.denegar', 'ADMIN', 'entrega.denegar'),
('ENTREGA:entrega.denegar', 'ENTREGA', 'entrega.denegar'),
('ADMIN_CAJA:entrega.denegar', 'ADMIN_CAJA', 'entrega.denegar'),
('ADMIN:entrega.reingresar', 'ADMIN', 'entrega.reingresar'),
('ENTREGA:entrega.reingresar', 'ENTREGA', 'entrega.reingresar'),
('ADMIN_CAJA:entrega.reingresar', 'ADMIN_CAJA', 'entrega.reingresar'),
('ADMIN:entrega.solicitar_bajar_deposito', 'ADMIN', 'entrega.solicitar_bajar_deposito'),
('ENTREGA:entrega.solicitar_bajar_deposito', 'ENTREGA', 'entrega.solicitar_bajar_deposito'),
('ADMIN_CAJA:entrega.solicitar_bajar_deposito', 'ADMIN_CAJA', 'entrega.solicitar_bajar_deposito'),
('ADMIN:entrega.enviar_deposito', 'ADMIN', 'entrega.enviar_deposito'),
('ENTREGA:entrega.enviar_deposito', 'ENTREGA', 'entrega.enviar_deposito'),
('ADMIN_CAJA:entrega.enviar_deposito', 'ADMIN_CAJA', 'entrega.enviar_deposito'),
('ADMIN:entrega.excepcional', 'ADMIN', 'entrega.excepcional'),
('ADMIN_CAJA:entrega.excepcional', 'ADMIN_CAJA', 'entrega.excepcional'),
('ADMIN:entrega.corregir', 'ADMIN', 'entrega.corregir'),
('ADMIN:buscador.buscar', 'ADMIN', 'buscador.buscar'),
('SUPERVISOR:buscador.buscar', 'SUPERVISOR', 'buscador.buscar'),
('ENTREGA:buscador.buscar', 'ENTREGA', 'buscador.buscar'),
('CONSULTA:buscador.buscar', 'CONSULTA', 'buscador.buscar'),
('ADMIN_CAJA:buscador.buscar', 'ADMIN_CAJA', 'buscador.buscar'),
('ADMIN:buscador.ver_historial', 'ADMIN', 'buscador.ver_historial'),
('SUPERVISOR:buscador.ver_historial', 'SUPERVISOR', 'buscador.ver_historial'),
('ENTREGA:buscador.ver_historial', 'ENTREGA', 'buscador.ver_historial'),
('CONSULTA:buscador.ver_historial', 'CONSULTA', 'buscador.ver_historial'),
('ADMIN_CAJA:buscador.ver_historial', 'ADMIN_CAJA', 'buscador.ver_historial'),
('ADMIN:etiquetas.ver', 'ADMIN', 'etiquetas.ver'),
('RECEPCION:etiquetas.ver', 'RECEPCION', 'etiquetas.ver'),
('ADMIN:etiquetas.generar', 'ADMIN', 'etiquetas.generar'),
('ADMIN:etiquetas.reimprimir', 'ADMIN', 'etiquetas.reimprimir'),
('RECEPCION:etiquetas.reimprimir', 'RECEPCION', 'etiquetas.reimprimir'),
('ADMIN:etiquetas.eliminar_lote', 'ADMIN', 'etiquetas.eliminar_lote'),
('ADMIN:etiquetas.configurar_meses', 'ADMIN', 'etiquetas.configurar_meses'),
('ADMIN:finanzas.ver_caja', 'ADMIN', 'finanzas.ver_caja'),
('SUPERVISOR:finanzas.ver_caja', 'SUPERVISOR', 'finanzas.ver_caja'),
('ADMIN:finanzas.registrar_cobros', 'ADMIN', 'finanzas.registrar_cobros'),
('SUPERVISOR:finanzas.registrar_cobros', 'SUPERVISOR', 'finanzas.registrar_cobros'),
('ADMIN:finanzas.registrar_gastos', 'ADMIN', 'finanzas.registrar_gastos'),
('SUPERVISOR:finanzas.registrar_gastos', 'SUPERVISOR', 'finanzas.registrar_gastos'),
('ADMIN:finanzas.cerrar_caja', 'ADMIN', 'finanzas.cerrar_caja'),
('SUPERVISOR:finanzas.cerrar_caja', 'SUPERVISOR', 'finanzas.cerrar_caja'),
('ADMIN:reportes.ver', 'ADMIN', 'reportes.ver'),
('SUPERVISOR:reportes.ver', 'SUPERVISOR', 'reportes.ver'),
('ADMIN:reportes.exportar', 'ADMIN', 'reportes.exportar'),
('SUPERVISOR:reportes.exportar', 'SUPERVISOR', 'reportes.exportar'),
('ADMIN:admin.usuarios', 'ADMIN', 'admin.usuarios'),
('ADMIN:admin.roles', 'ADMIN', 'admin.roles'),
('ADMIN:admin.config_empresa', 'ADMIN', 'admin.config_empresa'),
('ADMIN:admin.destinos', 'ADMIN', 'admin.destinos'),
('ADMIN:admin.tarifas', 'ADMIN', 'admin.tarifas'),
('ADMIN:admin.feriados', 'ADMIN', 'admin.feriados'),
('ADMIN:admin.series', 'ADMIN', 'admin.series'),
('ADMIN:admin.importacion', 'ADMIN', 'admin.importacion'),
('ADMIN:admin.auditoria', 'ADMIN', 'admin.auditoria'),
('ADMIN:admin.respaldos', 'ADMIN', 'admin.respaldos');
