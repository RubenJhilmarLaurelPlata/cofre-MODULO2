// src/lib/paquete-foto.ts
// Foto opcional de un paquete, tomada en Recepcion (camara o galeria).
// Mismo criterio que los respaldos (src/lib/respaldos.ts): se guarda en
// disco, fuera de "public/", y solo se sirve mediante un endpoint que
// verifica sesion — nunca queda accesible por URL directa. Se referencia
// por el id del paquete (no por su codigo) para no depender de texto que
// llega del cliente al construir la ruta del archivo.

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const CARPETA_FOTOS = path.join(process.cwd(), 'data', 'paquete-fotos');
const FORMATOS_PERMITIDOS: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };
const MAX_FOTO_BYTES = 3_000_000; // ~3MB decodificado

export function extensionValida(mime: string): string | null {
  const m = /^(png|jpe?g|webp)$/.exec(mime);
  return m?.[1] ? FORMATOS_PERMITIDOS[m[1]] ?? null : null;
}

/** Guarda una foto enviada como data URL (data:image/...;base64,...) y devuelve el nombre de archivo a guardar en Package.fotoArchivo. */
export async function guardarFotoPaquete(packageId: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error('Formato de imagen no soportado (usa PNG, JPG o WEBP).');
  const ext = extensionValida(match[1]);
  if (!ext) throw new Error('Formato de imagen no soportado.');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength > MAX_FOTO_BYTES) throw new Error('La foto es demasiado grande (máximo ~3MB).');

  await mkdir(CARPETA_FOTOS, { recursive: true });
  const nombreArchivo = `${packageId}.${ext}`;
  await writeFile(path.join(CARPETA_FOTOS, nombreArchivo), buffer);
  return nombreArchivo;
}

export async function leerFotoPaquete(nombreArchivo: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const ext = nombreArchivo.split('.').pop() ?? '';
  const tipo = FORMATOS_PERMITIDOS[ext];
  if (!tipo) return null;
  try {
    const buffer = await readFile(path.join(CARPETA_FOTOS, nombreArchivo));
    return { buffer, contentType: `image/${tipo}` };
  } catch {
    return null;
  }
}

export async function eliminarFotoPaquete(nombreArchivo: string): Promise<void> {
  try {
    await unlink(path.join(CARPETA_FOTOS, nombreArchivo));
  } catch {
    // Si ya no existe, no hay nada que hacer.
  }
}
