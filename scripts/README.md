# Respaldos — instalación en un servidor nuevo (La Paz / El Alto / futuras)

Esta carpeta contiene plantillas de referencia para el mecanismo de
respaldo que `src/lib/backup-oracle.ts` dispara y lee, pero que corre
**fuera** de la aplicación Next.js/PM2: un script de shell + Oracle
Object Storage. Ninguno de estos archivos se ejecuta automáticamente
solo por existir en el repositorio — hace falta instalarlos a mano en
cada servidor.

**Importante — sin probar contra Oracle real**: este entorno de
desarrollo no tiene acceso a `oci`-cli ni a un bucket real, así que estos
archivos no se pudieron probar de punta a punta contra infraestructura
real. Están escritos con cuidado (integrity check antes de subir, nunca
borran nada por su cuenta, mismos flags que ya usa `backup-oracle.ts`),
pero la primera ejecución en cada servidor nuevo debe hacerse a mano y
verificarse en la consola de Oracle Cloud antes de confiar en la
automatización.

## Qué resuelve

Los dos errores reportados en producción —

- `No se encontró el comando 'oci' en este servidor.`
- `El script de respaldo (/usr/local/bin/backup-cofre.sh) no existe en este servidor.`

— son exactamente lo que dicen: infraestructura de servidor que falta,
no un bug de la aplicación. `backup-oracle.ts` ya está diseñado para
detectar ambas condiciones sin fallar de forma confusa y sin fingir
éxito. Estos archivos son la infraestructura que falta.

## Pasos para una instalación nueva

1. **Instalar el script**:
   ```
   sudo cp scripts/backup-cofre.sh /usr/local/bin/backup-cofre.sh
   sudo chmod +x /usr/local/bin/backup-cofre.sh
   ```
2. **Instalar el CLI de OCI** (si no está): `pip install --user oci-cli`.
   Confirmar que un shell de login lo encuentra: `bash -lc 'command -v oci'`
   (la app ya intenta esto mismo como resolución automática — ver el
   comentario de `resolverOciBin()` en `src/lib/backup-oracle.ts`).
3. **Dar acceso a Object Storage**: la autenticación es *Instance
   Principal* (sin llaves estáticas) — la instancia de OCI donde corre
   este servidor debe pertenecer a un *dynamic group* con una *policy*
   que le dé permiso sobre el bucket elegido.
4. **Configurar variables propias para ESTA sucursal** — ver
   `.env.example` en la raíz del proyecto. Como mínimo, si esta
   instalación NO debe compartir almacenamiento con otra sucursal ya
   existente, definir `ORACLE_BACKUP_BUCKET`/`ORACLE_NAMESPACE` con un
   valor distinto al de esa otra sucursal (tanto en el `.env` de la app
   como en el entorno del sistema que ve `backup-cofre.sh`, ya que este
   script corre fuera del proceso Node).
5. **Automatización periódica** (opcional pero recomendado):
   ```
   sudo cp scripts/backup-cofre.service scripts/backup-cofre.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now backup-cofre.timer
   ```
6. **Verificar manualmente antes de confiar en el botón/timer**:
   ```
   sudo -u <usuario-de-la-app> bash /usr/local/bin/backup-cofre.sh
   ```
   y confirmar en la consola de Oracle Cloud (Storage > el bucket) que
   el objeto apareció con el nombre esperado.
7. **Retención**: configurarla como una *Lifecycle Policy* del bucket en
   la consola de Oracle Cloud (Storage > el bucket > Lifecycle Policies),
   no con lógica de borrado dentro del script — es más seguro dejar que
   la política nativa de Oracle expire objetos viejos que hacer que un
   script intente parsear fechas y borrar cosas por su cuenta.

## No mezclar sucursales

Cada instalación (La Paz, El Alto, futuras) corre su propia base de
datos SQLite de forma completamente independiente. Si dos instalaciones
no configuran un bucket/namespace propio, **ambas caerían en el mismo
valor por defecto** y sus respaldos terminarían en el mismo lugar. El
bucket/namespace/script activos de esta instalación se muestran en
Configuración → Respaldos para poder verificarlos sin adivinar.
