#!/usr/bin/env bash

set -u

# ============================================================
# AUDITORÍA FORENSE DE PRODUCCIÓN — COFRE EXPRESS
# ============================================================
# SOLO LECTURA.
#
# NO modifica:
#   - Package
#   - Pago
#   - User
#   - Company
#   - CajaSesion
#   - CierreCaja
#   - PackageHistory
#   - ninguna otra tabla
#
# NO ejecuta:
#   - prisma db push
#   - prisma migrate
#   - npm install
#   - npm build
#   - pm2 restart
#
# ============================================================

PROJECT="$HOME/cofre-MODULO2"
DB="$PROJECT/prisma/dev.db"

echo "============================================================"
echo " AUDITORÍA FORENSE — COFRE EXPRESS"
echo "============================================================"
echo "Fecha de ejecución:"
date
echo

echo "============================================================"
echo "1. SERVIDOR / PROYECTO / COMMIT"
echo "============================================================"

echo "Hostname:"
hostname
echo

echo "Sistema:"
uname -a
echo

echo "Directorio:"
pwd
echo

echo "Proyecto:"
echo "$PROJECT"
echo

echo "Git:"
git -C "$PROJECT" status --short 2>/dev/null || true
git -C "$PROJECT" log -1 --oneline 2>/dev/null || true
echo

echo "============================================================"
echo "2. ZONA HORARIA REAL"
echo "============================================================"

echo "date:"
date

echo
echo "date -u:"
date -u

echo
echo "TZ del shell:"
echo "${TZ:-<NO DEFINIDA>}"

echo
echo "timedatectl:"
timedatectl 2>&1 || true

echo
echo "Zona horaria de Node:"
node -e '
console.log("Date:", new Date().toString());
console.log("ISO:", new Date().toISOString());
console.log(
  "Intl TZ:",
  Intl.DateTimeFormat().resolvedOptions().timeZone
);
' 2>&1 || true

echo
echo "PM2 TZ:"
pm2 env 0 2>/dev/null | grep -iE '(^|_)TZ=' || echo "<TZ no encontrada en PM2>"

echo

echo "============================================================"
echo "3. BASE DE DATOS REAL"
echo "============================================================"

if [ ! -f "$DB" ]; then
    echo "ERROR: No existe la BD:"
    echo "$DB"
    exit 1
fi

echo "BD:"
ls -lh "$DB"

echo
echo "Tamaño:"
du -h "$DB"

echo
echo "SQLite:"
sqlite3 "$DB" "SELECT sqlite_version();"

echo
echo "Integridad SQLite:"
sqlite3 "$DB" "PRAGMA integrity_check;"

echo
echo "Conteos:"
sqlite3 "$DB" <<'SQL'
SELECT 'Package' AS tabla, COUNT(*) AS cantidad FROM Package
UNION ALL
SELECT 'Pago', COUNT(*) FROM Pago
UNION ALL
SELECT 'User', COUNT(*) FROM User
UNION ALL
SELECT 'PackageHistory', COUNT(*) FROM PackageHistory
UNION ALL
SELECT 'PackageSeries', COUNT(*) FROM PackageSeries
UNION ALL
SELECT 'ImportLog', COUNT(*) FROM ImportLog
UNION ALL
SELECT 'CajaSesion', COUNT(*) FROM CajaSesion
UNION ALL
SELECT 'CierreCaja', COUNT(*) FROM CierreCaja;
SQL

echo

echo "============================================================"
echo "4. CONFIGURACIÓN REAL DE COMPANY"
echo "============================================================"

sqlite3 "$DB" <<'SQL'
.headers on
.mode column

SELECT
    id,
    tarifaBase,
    diasIncluidos,
    costoAdicionalDia,
    cierreAutomaticoHabilitado,
    horaCierreAutomatico
FROM Company;
SQL

echo

echo "============================================================"
echo "5. HOY — BOUNDARY AMÉRICA/LA_PAZ"
echo "============================================================"

TODAY=$(TZ=America/La_Paz date '+%Y-%m-%d')
TOMORROW=$(TZ=America/La_Paz date -d 'tomorrow' '+%Y-%m-%d')

echo "Hoy en América/La_Paz: $TODAY"
echo "Mañana en América/La_Paz: $TOMORROW"

GTE="${TODAY}T04:00:00.000Z"
LT="${TOMORROW}T04:00:00.000Z"

echo
echo "Boundary UTC esperado para La Paz:"
echo "GTE = $GTE"
echo "LT  = $LT"

echo

echo "============================================================"
echo "6. ENTREGADOS HOY — TODOS, SIN IMPORTAR FECHA DE INGRESO"
echo "============================================================"

echo "TOTAL:"
sqlite3 "$DB" "
SELECT COUNT(*)
FROM Package
WHERE entregaAt >= '$GTE'
  AND entregaAt < '$LT';
"

echo
echo "DETALLE:"
sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    code,
    status,
    entregaAt,
    ingresoAt,
    montoPagado,
    estadoPago
FROM Package
WHERE entregaAt >= '$GTE'
  AND entregaAt < '$LT'
ORDER BY entregaAt;
SQL

echo

echo "============================================================"
echo "7. ENTREGAS POR TIPO"
echo "============================================================"

echo "Estados / tipos encontrados en Package:"
sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    status,
    COUNT(*) AS cantidad
FROM Package
WHERE entregaAt >= '$GTE'
  AND entregaAt < '$LT'
GROUP BY status
ORDER BY cantidad DESC;
SQL

echo

echo "============================================================"
echo "8. ENTREGAS EXCEPCIONALES"
echo "============================================================"

echo "Buscando campos relacionados con excepcional..."

sqlite3 "$DB" <<SQL
.headers on
.mode column

PRAGMA table_info(Package);
SQL

echo

echo "Registros entregados hoy cuyo historial menciona EXCEPCIONAL:"
sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    p.entregaAt,
    ph.createdAt,
    ph.action,
    ph.details
FROM Package p
LEFT JOIN PackageHistory ph
    ON ph.packageId = p.id
WHERE p.entregaAt >= '$GTE'
  AND p.entregaAt < '$LT'
  AND (
      UPPER(COALESCE(ph.action,'')) LIKE '%EXCEPCIONAL%'
      OR UPPER(COALESCE(ph.details,'')) LIKE '%EXCEPCIONAL%'
      OR UPPER(COALESCE(ph.action,'')) LIKE '%EXCEPCIONAL%'
      OR UPPER(COALESCE(ph.details,'')) LIKE '%MOTIVO%'
  )
ORDER BY p.entregaAt;
SQL

echo

echo "============================================================"
echo "9. FINANZAS — PAGOS REALIZADOS HOY"
echo "============================================================"

echo "Cantidad de movimientos:"
sqlite3 "$DB" "
SELECT COUNT(*)
FROM Pago
WHERE createdAt >= '$GTE'
  AND createdAt < '$LT';
"

echo
echo "Por tipo:"
sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    tipo,
    COUNT(*) AS movimientos,
    ROUND(SUM(monto),2) AS total_bs
FROM Pago
WHERE createdAt >= '$GTE'
  AND createdAt < '$LT'
GROUP BY tipo
ORDER BY tipo;
SQL

echo

echo "TOTAL BS:"
sqlite3 "$DB" "
SELECT COALESCE(ROUND(SUM(monto),2),0)
FROM Pago
WHERE createdAt >= '$GTE'
  AND createdAt < '$LT';
"

echo

echo "============================================================"
echo "10. DETALLE DE CADA MOVIMIENTO FINANCIERO"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    pg.tipo,
    pg.monto,
    pg.createdAt,
    pg.userId,
    p.status,
    p.ingresoAt,
    p.entregaAt,
    p.montoPagado,
    p.estadoPago
FROM Pago pg
JOIN Package p
    ON p.id = pg.packageId
WHERE pg.createdAt >= '$GTE'
  AND pg.createdAt < '$LT'
ORDER BY pg.createdAt;
SQL

echo

echo "============================================================"
echo "11. COBRO DE ENTREGA VS ANTICIPO VS AJUSTE"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    CASE
        WHEN tipo = 'COBRO_ENTREGA' THEN 'COBRO DE ENTREGA'
        WHEN tipo = 'ANTICIPO' THEN 'ANTICIPO'
        WHEN tipo = 'AJUSTE' THEN 'AJUSTE'
        ELSE tipo
    END AS categoria,
    COUNT(*) AS movimientos,
    ROUND(SUM(monto),2) AS bs
FROM Pago
WHERE createdAt >= '$GTE'
  AND createdAt < '$LT'
GROUP BY tipo
ORDER BY tipo;
SQL

echo

echo "============================================================"
echo "12. COBRADOS HOY PERO NO ENTREGADOS HOY"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    pg.tipo,
    pg.monto,
    pg.createdAt,
    p.status,
    p.ingresoAt,
    p.entregaAt
FROM Pago pg
JOIN Package p
    ON p.id = pg.packageId
WHERE pg.createdAt >= '$GTE'
  AND pg.createdAt < '$LT'
  AND (
      p.entregaAt IS NULL
      OR p.entregaAt < '$GTE'
      OR p.entregaAt >= '$LT'
  )
ORDER BY pg.createdAt;
SQL

echo

echo "============================================================"
echo "13. ENTREGADOS HOY SIN NINGÚN PAGO"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    p.entregaAt,
    p.ingresoAt,
    p.status,
    p.montoPagado,
    p.estadoPago
FROM Package p
WHERE p.entregaAt >= '$GTE'
  AND p.entregaAt < '$LT'
  AND NOT EXISTS (
      SELECT 1
      FROM Pago pg
      WHERE pg.packageId = p.id
  )
ORDER BY p.entregaAt;
SQL

echo

echo "============================================================"
echo "14. PAQUETES CON ANTICIPOS HOY"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    pg.monto,
    pg.createdAt,
    pg.userId,
    p.status,
    p.ingresoAt,
    p.entregaAt
FROM Pago pg
JOIN Package p
    ON p.id = pg.packageId
WHERE pg.tipo = 'ANTICIPO'
  AND pg.createdAt >= '$GTE'
  AND pg.createdAt < '$LT'
ORDER BY pg.createdAt;
SQL

echo

echo "============================================================"
echo "15. PAQUETES CON AJUSTES HOY"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    pg.monto,
    pg.createdAt,
    pg.userId,
    p.status,
    p.montoPagado,
    p.estadoPago
FROM Pago pg
JOIN Package p
    ON p.id = pg.packageId
WHERE pg.tipo = 'AJUSTE'
  AND pg.createdAt >= '$GTE'
  AND pg.createdAt < '$LT'
ORDER BY pg.createdAt;
SQL

echo

echo "============================================================"
echo "16. ENTREGADOS HOY AGRUPADOS POR FECHA DE INGRESO"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    substr(ingresoAt,1,10) AS fecha_ingreso,
    COUNT(*) AS entregados_hoy
FROM Package
WHERE entregaAt >= '$GTE'
  AND entregaAt < '$LT'
GROUP BY substr(ingresoAt,1,10)
ORDER BY fecha_ingreso;
SQL

echo

echo "============================================================"
echo "17. ENTREGADOS HOY VS INGRESADOS HOY"
echo "============================================================"

echo "Ingresados hoy:"
sqlite3 "$DB" "
SELECT COUNT(*)
FROM Package
WHERE ingresoAt >= '$GTE'
  AND ingresoAt < '$LT';
"

echo
echo "Entregados hoy:"
sqlite3 "$DB" "
SELECT COUNT(*)
FROM Package
WHERE entregaAt >= '$GTE'
  AND entregaAt < '$LT';
"

echo

echo "============================================================"
echo "18. DIFERENCIA — CÓDIGOS ENTREGADOS HOY"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    p.code,
    p.ingresoAt,
    p.entregaAt,
    p.status,
    p.montoPagado,
    p.estadoPago
FROM Package p
WHERE p.entregaAt >= '$GTE'
  AND p.entregaAt < '$LT'
ORDER BY p.code;
SQL

echo

echo "============================================================"
echo "19. POSIBLE HERENCIA DE PAGADO / ANTICIPOS EN RACHA"
echo "============================================================"

sqlite3 "$DB" <<SQL
.headers on
.mode column

SELECT
    pg.userId,
    pg.monto,
    COUNT(*) AS cantidad,
    MIN(pg.createdAt) AS primero,
    MAX(pg.createdAt) AS ultimo
FROM Pago pg
WHERE pg.tipo = 'ANTICIPO'
  AND pg.createdAt >= '$GTE'
  AND pg.createdAt < '$LT'
GROUP BY pg.userId, pg.monto
HAVING COUNT(*) >= 2
ORDER BY cantidad DESC;
SQL

echo

echo "============================================================"
echo "20. INCONSISTENCIAS MONTO PAGADO VS LEDGER"
echo "============================================================"

sqlite3 "$DB" <<'SQL'
.headers on
.mode column

SELECT
    p.code,
    p.montoPagado,
    COALESCE(SUM(pg.monto),0) AS suma_ledger,
    ROUND(
        p.montoPagado - COALESCE(SUM(pg.monto),0),
        2
    ) AS diferencia
FROM Package p
LEFT JOIN Pago pg
    ON pg.packageId = p.id
GROUP BY p.id
HAVING ABS(
    p.montoPagado - COALESCE(SUM(pg.monto),0)
) > 0.001
ORDER BY ABS(
    p.montoPagado - COALESCE(SUM(pg.monto),0)
) DESC;
SQL

echo

echo "============================================================"
echo "21. USUARIOS REALES"
echo "============================================================"

sqlite3 "$DB" <<'SQL'
.headers on
.mode column

SELECT
    id,
    username,
    nombre,
    role,
    activo,
    eliminadoAt,
    createdAt
FROM User
ORDER BY createdAt;
SQL

echo

echo "============================================================"
echo "22. CAJA — ESTADO ACTUAL"
echo "============================================================"

sqlite3 "$DB" <<'SQL'
.headers on
.mode column

SELECT *
FROM CajaSesion
ORDER BY id DESC
LIMIT 5;
SQL

echo

echo "CIERRES RECIENTES:"
sqlite3 "$DB" <<'SQL'
.headers on
.mode column

SELECT *
FROM CierreCaja
ORDER BY id DESC
LIMIT 10;
SQL

echo

echo "============================================================"
echo "23. PM2"
echo "============================================================"

pm2 status 2>&1 || true

echo
pm2 show cofre-express 2>&1 || true

echo

echo "============================================================"
echo "24. LOGS PM2 — ERRORES RECIENTES"
echo "============================================================"

pm2 logs cofre-express --lines 30 --nostream 2>&1 || true

echo

echo "============================================================"
echo "25. BACKUP SYSTEMD"
echo "============================================================"

echo "Timer:"
sudo systemctl status backup-cofre.timer --no-pager 2>&1 || true

echo
echo "Service:"
sudo systemctl status backup-cofre.service --no-pager 2>&1 || true

echo
echo "Últimas ejecuciones:"
sudo journalctl -u backup-cofre.service -n 30 --no-pager 2>&1 || true

echo

echo "============================================================"
echo "26. SCRIPT DE BACKUP"
echo "============================================================"

if [ -f /usr/local/bin/backup-cofre.sh ]; then
    ls -lh /usr/local/bin/backup-cofre.sh
    echo
    echo "Contenido:"
    sudo sed -n '1,240p' /usr/local/bin/backup-cofre.sh
else
    echo "No existe /usr/local/bin/backup-cofre.sh"
fi

echo

echo "============================================================"
echo "27. FIN DE AUDITORÍA"
echo "============================================================"

echo "NO SE REALIZARON CAMBIOS EN LA BASE DE DATOS."
echo "NO SE EJECUTARON MIGRACIONES."
echo "NO SE EJECUTÓ PRISMA DB PUSH."
echo "NO SE REINICIÓ PM2."
echo "============================================================"