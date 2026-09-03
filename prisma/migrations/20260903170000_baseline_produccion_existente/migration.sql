-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "branchId" TEXT,
    "ultimoAccesoAt" DATETIME,
    "ultimoLoginAt" DATETIME,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" DATETIME,
    "eliminadoAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Company" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "nombre" TEXT NOT NULL DEFAULT 'Cofre Express',
    "logoUrl" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "sitioWeb" TEXT,
    "ciudad" TEXT,
    "pais" TEXT,
    "horarioAtencion" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'Bs',
    "tarifaBase" REAL NOT NULL DEFAULT 2,
    "diasIncluidos" INTEGER NOT NULL DEFAULT 4,
    "costoAdicionalDia" REAL NOT NULL DEFAULT 1,
    "formatoLetra" TEXT NOT NULL DEFAULT 'L',
    "formatoSeparador" TEXT NOT NULL DEFAULT '-',
    "formatoDigitos" INTEGER NOT NULL DEFAULT 3,
    "impedirDuplicados" BOOLEAN NOT NULL DEFAULT true,
    "impedirReutilizarEntregadosDenegados" BOOLEAN NOT NULL DEFAULT true,
    "mostrarCostoAcumuladoEnEntrega" BOOLEAN NOT NULL DEFAULT true,
    "sucursalActualId" TEXT,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/La_Paz',
    "formatoFecha" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "formatoHora" TEXT NOT NULL DEFAULT '24h',
    "sonidosActivos" BOOLEAN NOT NULL DEFAULT true,
    "tiempoMaximoSesionMin" INTEGER NOT NULL DEFAULT 720,
    "tiempoMaximoInactividadMin" INTEGER NOT NULL DEFAULT 0,
    "cerrarSesionAutomaticamente" BOOLEAN NOT NULL DEFAULT false,
    "maxIntentosLogin" INTEGER NOT NULL DEFAULT 5,
    "tiempoBloqueoMin" INTEGER NOT NULL DEFAULT 15,
    "montosPagoRapido" TEXT NOT NULL DEFAULT '2,3,5,7',
    "entregaCountdownSegundos" INTEGER NOT NULL DEFAULT 5,
    "climaLat" REAL,
    "climaLon" REAL,
    "s700Habilitado" BOOLEAN NOT NULL DEFAULT false,
    "s700AppId" TEXT,
    "s700DeveloperId" TEXT,
    "s700AppKey" TEXT,
    "cierreAutomaticoHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "horaCierreAutomatico" TEXT NOT NULL DEFAULT '20:00'
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fecha" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "PackageSeries" (
    "inicial" TEXT NOT NULL PRIMARY KEY,
    "descripcion" TEXT NOT NULL,
    "correlativo" INTEGER NOT NULL DEFAULT 0,
    "tarifaBaseOverride" REAL,
    "activo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "GeneratedCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "inicial" TEXT NOT NULL,
    "fechaGenerado" TEXT NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "vecesReimpreso" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tarifaOverride" REAL,
    "diasIncluidosOverride" INTEGER,
    "batchId" TEXT,
    CONSTRAINT "GeneratedCode_inicial_fkey" FOREIGN KEY ("inicial") REFERENCES "PackageSeries" ("inicial") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GeneratedCode_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LabelBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthLetter" (
    "mes" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "letra" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LabelBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inicial" TEXT NOT NULL,
    "fechaInicio" TEXT NOT NULL,
    "fechaFin" TEXT NOT NULL,
    "cantidadPorDia" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "separador" TEXT NOT NULL,
    "primerConsecutivo" INTEGER NOT NULL,
    "ultimoConsecutivo" INTEGER NOT NULL,
    "observaciones" TEXT NOT NULL DEFAULT '',
    "nombre" TEXT,
    "generadoPorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabelBatch_inicial_fkey" FOREIGN KEY ("inicial") REFERENCES "PackageSeries" ("inicial") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabelBatch_generadoPorId_fkey" FOREIGN KEY ("generadoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "codigoNormalizado" TEXT NOT NULL,
    "inicial" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EN_PAQUETERIA',
    "ingresoAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depositoAt" DATETIME,
    "pendienteAt" DATETIME,
    "entregaAt" DATETIME,
    "denegadoAt" DATETIME,
    "tarifaBaseOverride" REAL,
    "diasIncluidosOverride" INTEGER,
    "remitente" TEXT,
    "remitenteTelefono" TEXT,
    "destinatario" TEXT,
    "destinatarioTelefono" TEXT,
    "destinatarioObservaciones" TEXT,
    "observaciones" TEXT NOT NULL DEFAULT '',
    "descripcion" TEXT,
    "fotoArchivo" TEXT,
    "clienteId" TEXT,
    "estadoPago" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "montoPagado" REAL NOT NULL DEFAULT 0,
    "registradoPorId" TEXT,
    "origenEntrega" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Package_inicial_fkey" FOREIGN KEY ("inicial") REFERENCES "PackageSeries" ("inicial") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Package_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Package_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Package_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT,
    "emprendimiento" TEXT,
    "telefono" TEXT,
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportLog" (
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
    CONSTRAINT "ImportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importLogId" TEXT NOT NULL,
    "numeroFila" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigoOficial" TEXT,
    "packageId" TEXT,
    "monto" REAL,
    "persona" TEXT,
    "estado" TEXT NOT NULL,
    "motivo" TEXT,
    CONSTRAINT "ImportRow_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "montoAnterior" REAL,
    "montoNuevo" REAL,
    "motivo" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pago_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pago_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concepto" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observaciones" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Gasto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CierreCaja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fechaInicio" DATETIME NOT NULL,
    "fechaFin" DATETIME NOT NULL,
    "ingresos" REAL NOT NULL,
    "gastos" REAL NOT NULL,
    "ajustes" REAL NOT NULL DEFAULT 0,
    "resultadoNeto" REAL NOT NULL,
    "paquetesCobrados" INTEGER NOT NULL,
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "efectivoDeclarado" REAL,
    "diferencia" REAL,
    "estado" TEXT NOT NULL DEFAULT 'CONFIRMADO',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CierreCaja_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CajaSesion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "abiertaAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abiertaPorId" TEXT,
    "cerradaAt" DATETIME,
    "cerradaPorId" TEXT,
    "cierreCajaId" TEXT,
    CONSTRAINT "CajaSesion_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CajaSesion_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CajaSesion_cierreCajaId_fkey" FOREIGN KEY ("cierreCajaId") REFERENCES "CierreCaja" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "nota" TEXT,
    CONSTRAINT "PackageHistory_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tipo" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "filtros" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "accion" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNuevo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombreArchivo" TEXT NOT NULL,
    "tamanioBytes" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'COMPLETADO',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Backup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_nombre_key" ON "Branch"("nombre");

-- CreateIndex
CREATE INDEX "Holiday_fecha_idx" ON "Holiday"("fecha");

-- CreateIndex
CREATE INDEX "GeneratedCode_inicial_idx" ON "GeneratedCode"("inicial");

-- CreateIndex
CREATE INDEX "GeneratedCode_usado_idx" ON "GeneratedCode"("usado");

-- CreateIndex
CREATE INDEX "GeneratedCode_batchId_idx" ON "GeneratedCode"("batchId");

-- CreateIndex
CREATE INDEX "GeneratedCode_createdAt_idx" ON "GeneratedCode"("createdAt");

-- CreateIndex
CREATE INDEX "LabelBatch_inicial_idx" ON "LabelBatch"("inicial");

-- CreateIndex
CREATE INDEX "LabelBatch_createdAt_idx" ON "LabelBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Package_codigoNormalizado_key" ON "Package"("codigoNormalizado");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE INDEX "Package_ingresoAt_idx" ON "Package"("ingresoAt");

-- CreateIndex
CREATE INDEX "Package_entregaAt_idx" ON "Package"("entregaAt");

-- CreateIndex
CREATE INDEX "Package_depositoAt_idx" ON "Package"("depositoAt");

-- CreateIndex
CREATE INDEX "Package_branchId_idx" ON "Package"("branchId");

-- CreateIndex
CREATE INDEX "Package_destinatario_idx" ON "Package"("destinatario");

-- CreateIndex
CREATE INDEX "Package_destinatarioTelefono_idx" ON "Package"("destinatarioTelefono");

-- CreateIndex
CREATE INDEX "Package_remitenteTelefono_idx" ON "Package"("remitenteTelefono");

-- CreateIndex
CREATE INDEX "Package_registradoPorId_idx" ON "Package"("registradoPorId");

-- CreateIndex
CREATE INDEX "Package_clienteId_idx" ON "Package"("clienteId");

-- CreateIndex
CREATE INDEX "Package_estadoPago_idx" ON "Package"("estadoPago");

-- CreateIndex
CREATE INDEX "Cliente_telefono_idx" ON "Cliente"("telefono");

-- CreateIndex
CREATE INDEX "Cliente_nombre_idx" ON "Cliente"("nombre");

-- CreateIndex
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_importLogId_idx" ON "ImportRow"("importLogId");

-- CreateIndex
CREATE INDEX "ImportRow_estado_idx" ON "ImportRow"("estado");

-- CreateIndex
CREATE INDEX "ImportRow_codigo_idx" ON "ImportRow"("codigo");

-- CreateIndex
CREATE INDEX "Pago_packageId_idx" ON "Pago"("packageId");

-- CreateIndex
CREATE INDEX "Pago_tipo_idx" ON "Pago"("tipo");

-- CreateIndex
CREATE INDEX "Pago_createdAt_idx" ON "Pago"("createdAt");

-- CreateIndex
CREATE INDEX "Gasto_fecha_idx" ON "Gasto"("fecha");

-- CreateIndex
CREATE INDEX "CierreCaja_createdAt_idx" ON "CierreCaja"("createdAt");

-- CreateIndex
CREATE INDEX "CierreCaja_fechaInicio_idx" ON "CierreCaja"("fechaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "CajaSesion_cierreCajaId_key" ON "CajaSesion"("cierreCajaId");

-- CreateIndex
CREATE INDEX "CajaSesion_cerradaAt_idx" ON "CajaSesion"("cerradaAt");

-- CreateIndex
CREATE INDEX "CajaSesion_abiertaAt_idx" ON "CajaSesion"("abiertaAt");

-- CreateIndex
CREATE INDEX "PackageHistory_packageId_idx" ON "PackageHistory"("packageId");

-- CreateIndex
CREATE INDEX "PackageHistory_fecha_idx" ON "PackageHistory"("fecha");

-- CreateIndex
CREATE INDEX "PackageHistory_userId_idx" ON "PackageHistory"("userId");

-- CreateIndex
CREATE INDEX "ReportLog_tipo_idx" ON "ReportLog"("tipo");

-- CreateIndex
CREATE INDEX "ReportLog_createdAt_idx" ON "ReportLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_modulo_idx" ON "AuditLog"("modulo");

-- CreateIndex
CREATE INDEX "AuditLog_accion_idx" ON "AuditLog"("accion");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt");

