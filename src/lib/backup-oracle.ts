// src/lib/backup-oracle.ts
// Puente entre Configuracion > Respaldos y el mecanismo REAL de backup ya
// funcionando en el servidor de produccion (script + Oracle Object
// Storage, ver CLAUDE.md) — nunca reimplementa ese mecanismo, solo lo
// dispara y lee su resultado. Todas las rutas/nombres vienen de variables
// de entorno con default igual a lo que ya usa el servidor; no hay
// ninguna credencial que proteger aca (la autenticacion es Instance
// Principal, sin claves estaticas).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, copyFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

/** execFile con promisify pierde el detalle util del error (stdout/stderr/timeout) en err.message ("Command failed: ..." a secas) — esta funcion lo reconstruye para que el administrador vea la causa real, no un mensaje generico. */
function formatearErrorComando(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { killed?: boolean; signal?: string; code?: string | number; stderr?: string; message?: string };
    if (e.killed && e.signal === 'SIGTERM') {
      return 'El comando no respondió a tiempo (tiempo de espera agotado). Si esto corre fuera del servidor de producción, es normal: Instance Principal solo funciona dentro de la instancia OCI real.';
    }
    if (e.code === 'ENOENT') {
      return `No se encontró el comando "${e.message?.split(' ')[1] ?? ''}" en este servidor.`;
    }
    const detalle = (e.stderr ?? '').trim();
    if (detalle) return detalle.slice(0, 2000);
  }
  return err instanceof Error ? err.message : 'Error desconocido.';
}

const BACKUP_SCRIPT = process.env.BACKUP_SCRIPT_PATH ?? '/usr/local/bin/backup-cofre.sh';
const OCI_BIN = process.env.OCI_CLI_PATH ?? 'oci';
const ORACLE_BUCKET = process.env.ORACLE_BACKUP_BUCKET ?? 'cofre-express-backups';
const ORACLE_NAMESPACE = process.env.ORACLE_NAMESPACE ?? 'grwpjc1fcohd';

export interface ResultadoBackupReal {
  ok: boolean;
  salida?: string;
  error?: string;
}

/** Ejecuta el script real de backup del servidor. Nunca finge éxito: si el script no existe en este entorno (ej. desarrollo local), lo dice explícitamente. */
export async function ejecutarBackupReal(): Promise<ResultadoBackupReal> {
  if (!existsSync(BACKUP_SCRIPT)) {
    return {
      ok: false,
      error: `El script de respaldo (${BACKUP_SCRIPT}) no existe en este servidor. Esta función está diseñada para ejecutarse en el servidor de producción, donde el script ya está instalado.`,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync('bash', [BACKUP_SCRIPT], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, salida: (stdout || stderr || '').trim().slice(-4000) };
  } catch (err) {
    return { ok: false, error: formatearErrorComando(err) };
  }
}

export interface RespaldoOracleDTO {
  nombre: string;
  tamanioBytes: number;
  fecha: string | null;
}

export interface ResultadoListaOracle {
  ok: boolean;
  objetos: RespaldoOracleDTO[];
  error?: string;
}

interface ObjetoOciCrudo {
  name?: string;
  size?: number;
  'time-created'?: string;
  timeCreated?: string;
}

/** Lista los respaldos reales disponibles en el bucket de Oracle Object Storage vía el CLI `oci`. Nunca inventa una lista si el CLI falla. */
export async function listarRespaldosOracle(): Promise<ResultadoListaOracle> {
  try {
    const { stdout } = await execFileAsync(
      OCI_BIN,
      ['os', 'object', 'list', '--bucket-name', ORACLE_BUCKET, '--namespace', ORACLE_NAMESPACE, '--auth', 'instance_principal', '--output', 'json'],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as { data?: ObjetoOciCrudo[] };
    const objetos: RespaldoOracleDTO[] = (parsed.data ?? [])
      .map((o) => ({
        nombre: o.name ?? '(sin nombre)',
        tamanioBytes: o.size ?? 0,
        fecha: o['time-created'] ?? o.timeCreated ?? null,
      }))
      .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || b.nombre.localeCompare(a.nombre));
    return { ok: true, objetos };
  } catch (err) {
    return { ok: false, objetos: [], error: formatearErrorComando(err) };
  }
}

export interface ResultadoRestauracion {
  ok: boolean;
  mensaje?: string;
  error?: string;
}

function rutaBaseDeDatos(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('file:')) return null;
  const rel = url.slice('file:'.length).split('?')[0] ?? '';
  if (!rel) return null;
  return path.resolve(process.cwd(), rel);
}

/**
 * Descarga un respaldo real desde Oracle, verifica su integridad ANTES de
 * tocar nada, guarda una copia de seguridad con timestamp de la base
 * actual, y recien ahi reemplaza el archivo. Nunca reinicia el proceso
 * Node por su cuenta (podria dejar la respuesta HTTP colgada o el
 * servicio en un estado indefinido) — el mensaje final deja explícito que
 * hace falta reiniciar el servicio (pm2 restart) para que el cambio
 * tenga efecto.
 */
export async function restaurarDesdeOracle(nombreArchivo: string): Promise<ResultadoRestauracion> {
  const dbPath = rutaBaseDeDatos();
  if (!dbPath) {
    return { ok: false, error: 'No se pudo determinar la ruta del archivo de base de datos actual (DATABASE_URL).' };
  }

  const tmpFile = path.join(os.tmpdir(), `cofre-restore-${Date.now()}-${nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  try {
    await execFileAsync(
      OCI_BIN,
      ['os', 'object', 'get', '--bucket-name', ORACLE_BUCKET, '--namespace', ORACLE_NAMESPACE, '--name', nombreArchivo, '--file', tmpFile, '--auth', 'instance_principal'],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (err) {
    return { ok: false, error: `No se pudo descargar "${nombreArchivo}" desde Oracle: ${formatearErrorComando(err)}` };
  }

  try {
    const { stdout } = await execFileAsync('sqlite3', [tmpFile, 'PRAGMA integrity_check;'], { timeout: 30_000 });
    if (stdout.trim() !== 'ok') {
      await fs.unlink(tmpFile).catch(() => {});
      return { ok: false, error: `El respaldo descargado no pasó la verificación de integridad (PRAGMA integrity_check devolvió: "${stdout.trim()}"). No se tocó la base de datos actual.` };
    }
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    return { ok: false, error: `No se pudo verificar la integridad del respaldo descargado: ${formatearErrorComando(err)}` };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copiaSeguridad = `${dbPath}.antes-de-restaurar-${timestamp}`;
  try {
    copyFileSync(dbPath, copiaSeguridad);
    copyFileSync(tmpFile, dbPath);
  } catch (err) {
    return { ok: false, error: `Se verificó el respaldo pero no se pudo reemplazar el archivo actual: ${err instanceof Error ? err.message : 'error desconocido'}` };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }

  return {
    ok: true,
    mensaje: `Restaurado desde "${nombreArchivo}". Se guardó una copia de la base anterior en "${path.basename(copiaSeguridad)}". Es necesario reiniciar el servicio para que el cambio tenga efecto: pm2 restart cofre-express`,
  };
}
