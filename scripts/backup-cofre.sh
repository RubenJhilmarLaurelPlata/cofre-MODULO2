#!/usr/bin/env bash
# scripts/backup-cofre.sh
#
# Plantilla de referencia para /usr/local/bin/backup-cofre.sh — el script
# que src/lib/backup-oracle.ts (Configuración > Respaldos > "Respaldar
# ahora") dispara con `bash /usr/local/bin/backup-cofre.sh` y que también
# puede correr solo, vía el timer de systemd (ver backup-cofre.timer/
# backup-cofre.service en esta misma carpeta).
#
# ESTE ARCHIVO NO SE EJECUTA AUTOMÁTICAMENTE EN NINGÚN SERVIDOR: es una
# plantilla que hay que copiar e instalar a mano en cada instalación
# (La Paz, El Alto, futuras) — ver "INSTALACIÓN" más abajo. No se probó
# contra un bucket ni credenciales reales (este entorno de desarrollo no
# tiene acceso a Oracle Cloud) — antes de confiar en él en producción,
# ejecútalo una vez a mano y confirma en la consola de OCI que el objeto
# apareció en el bucket correcto.
#
# Cada sucursal corre su PROPIA base de datos y debe usar su PROPIO
# bucket/namespace — nunca deben mezclarse (ver .env.example). Este
# script NUNCA borra respaldos antiguos por su cuenta: la retención se
# configura como una "Lifecycle Policy" nativa del bucket de Object
# Storage (Oracle Cloud Console > Storage > el bucket > Lifecycle
# Policies > "Delete after N days") — es más seguro dejar que Oracle
# expire objetos viejos con su propia política probada, que hacer que
# este script intente adivinar/parsear fechas y borrar cosas por su
# cuenta.
set -euo pipefail

# ---- Configuración de ESTA instalación ----
# Ajustar estos valores (o exportarlos antes de invocar el script) según
# el servidor: La Paz y El Alto deben usar rutas/buckets propios.
PROJECT_DIR="${COFRE_PROJECT_DIR:-$HOME/cofre-MODULO2}"
DB_PATH="${COFRE_DB_PATH:-$PROJECT_DIR/prisma/dev.db}"
BUCKET="${ORACLE_BACKUP_BUCKET:-cofre-express-backups}"
NAMESPACE="${ORACLE_NAMESPACE:-grwpjc1fcohd}"
# Prefijo opcional para distinguir a qué sucursal pertenece cada objeto
# dentro del bucket (útil sobre todo si, a propósito, dos instalaciones
# comparten el mismo bucket) — ej. "LPZ", "ELA". Vacío por defecto.
SUCURSAL="${COFRE_SUCURSAL_CODIGO:-}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Mismo criterio de zona horaria que el resto del sistema (ver
# next.config.mjs: todo el cálculo de fechas de la aplicación está
# anclado a America/La_Paz) — el nombre del archivo debe reflejar la
# fecha/hora real de Bolivia, nunca UTC del servidor.
FECHA="$(TZ=America/La_Paz date +%Y%m%d-%H%M%S)"
PREFIJO="${SUCURSAL:+${SUCURSAL}-}"
NOMBRE_ARCHIVO="cofre-express-${PREFIJO}${FECHA}.db"
DESTINO_TMP="$TMP_DIR/$NOMBRE_ARCHIVO"

echo "[backup-cofre] Respaldando $DB_PATH -> $BUCKET/$NOMBRE_ARCHIVO"

if [ ! -f "$DB_PATH" ]; then
  echo "[backup-cofre] ERROR: no se encontró la base de datos en $DB_PATH" >&2
  exit 1
fi
command -v sqlite3 >/dev/null 2>&1 || { echo "[backup-cofre] ERROR: sqlite3 no está instalado." >&2; exit 1; }
command -v oci >/dev/null 2>&1 || { echo "[backup-cofre] ERROR: oci CLI no está instalado (ver README.md de esta carpeta)." >&2; exit 1; }

# ".backup" usa la API online de SQLite: genera una copia consistente sin
# bloquear las escrituras en curso del proceso Node (que corre en modo
# WAL) — copiar el archivo .db directamente con `cp` mientras la app está
# escribiendo puede producir un archivo corrupto o a medio escribir.
sqlite3 "$DB_PATH" ".backup '$DESTINO_TMP'"

echo "[backup-cofre] Verificando integridad del respaldo generado..."
INTEGRIDAD="$(sqlite3 "$DESTINO_TMP" "PRAGMA integrity_check;")"
if [ "$INTEGRIDAD" != "ok" ]; then
  echo "[backup-cofre] ERROR: el respaldo no pasó integrity_check: $INTEGRIDAD" >&2
  exit 1
fi

echo "[backup-cofre] Subiendo a Oracle Object Storage..."
oci os object put \
  --bucket-name "$BUCKET" \
  --namespace "$NAMESPACE" \
  --auth instance_principal \
  --file "$DESTINO_TMP" \
  --name "$NOMBRE_ARCHIVO" \
  --force

echo "[backup-cofre] Respaldo completado: $NOMBRE_ARCHIVO"

# ============================================================
# INSTALACIÓN (una vez por servidor — La Paz, El Alto, futuras)
# ============================================================
#   1. sudo cp scripts/backup-cofre.sh /usr/local/bin/backup-cofre.sh
#      sudo chmod +x /usr/local/bin/backup-cofre.sh
#   2. Instalar el CLI de OCI si no está: pip install --user oci-cli
#      (confirmar con: bash -lc 'command -v oci')
#   3. Confirmar que esta instancia de OCI tiene una política de Instance
#      Principal que le da acceso al bucket de Object Storage elegido.
#   4. Definir COFRE_DB_PATH / ORACLE_BACKUP_BUCKET / ORACLE_NAMESPACE /
#      COFRE_SUCURSAL_CODIGO como variables de entorno del SISTEMA (no
#      solo del .env de Next — este script corre fuera del proceso Node,
#      ej. vía /etc/environment o dentro de backup-cofre.service) si esta
#      instalación no debe usar los valores por defecto de arriba.
#   5. (Opcional, recomendado) instalar la automatización periódica:
#      sudo cp scripts/backup-cofre.service scripts/backup-cofre.timer /etc/systemd/system/
#      sudo systemctl daemon-reload
#      sudo systemctl enable --now backup-cofre.timer
#   6. Ejecutar una vez a mano y confirmar en la consola de OCI que el
#      objeto apareció: sudo -u <usuario-de-la-app> bash /usr/local/bin/backup-cofre.sh
#   7. Configurar la retención como una Lifecycle Policy del bucket en la
#      consola de Oracle Cloud (Storage > bucket > Lifecycle Policies) en
#      vez de borrar objetos desde este script.
