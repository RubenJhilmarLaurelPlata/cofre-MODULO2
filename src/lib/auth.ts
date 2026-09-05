// src/lib/auth.ts
// Autenticacion real (no simulada): contraseñas con hash bcrypt, sesiones
// firmadas con JWT (jose, compatible con el runtime Edge del middleware).

import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import type { SessionUser } from '@/types';

export { SESSION_COOKIE };
const SESSION_DURATION_SECONDS_DEFAULT = 60 * 60 * 12; // 12 horas, usado si la empresa no configuro otra cosa

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET no está configurado o es demasiado corto. Define una variable de entorno JWT_SECRET (ver .env.example).'
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Si la request llega realmente por HTTPS — para decidir el atributo
 * `secure` de la cookie de sesion (ver login/route.ts). Cada instalacion
 * de Cofre Express (La Paz, El Alto, futuras) corre detras de su propio
 * Nginx, que termina TLS y reenvia a Next.js por HTTP interno agregando
 * `X-Forwarded-Proto: $scheme` — Next.js en Node (a diferencia de
 * Vercel) no reescribe el protocolo de la request con ese header por su
 * cuenta, asi que hay que leerlo explicitamente. NUNCA se decide esto
 * con NODE_ENV: una instalacion en produccion puede estar sirviendo
 * temporalmente por HTTP plano (ej. El Alto mientras se configura su
 * certificado) y NODE_ENV seguiria siendo "production" igual — forzar
 * `secure: true` ahi hace que el navegador directamente descarte la
 * cookie por HTTP, dejando el login "cargando" para siempre sin ningun
 * error visible.
 */
export function esRequestSegura(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]!.trim().toLowerCase() === 'https';
  return new URL(req.url).protocol === 'https:';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Firma la sesion. `duracionSegundos` viene de Company.tiempoMaximoSesionMin (Modulo 7); si no se indica, usa el valor por defecto. */
export async function signSession(user: SessionUser, duracionSegundos: number = SESSION_DURATION_SECONDS_DEFAULT): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${duracionSegundos}s`)
    .sign(getSecretKey());
}

/** Verifica un token y devuelve el usuario, o null si es invalido/expirado. */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.id || !payload.username || !payload.role) return null;
    return {
      id: payload.id as string,
      username: payload.username as string,
      nombre: payload.nombre as string,
      role: payload.role as SessionUser['role'],
      branchId: (payload.branchId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Lee la sesion actual desde la cookie httpOnly en un Server Component o
 * Route Handler. Devuelve null si no hay sesion, expiro, o si la cuenta
 * fue desactivada/bloqueada/quedo inactiva demasiado tiempo (Modulo 7:
 * estos cambios deben aplicarse de inmediato, no solo cuando expire el
 * JWT). De paso actualiza "ultimoAccesoAt" para que el temporizador de
 * inactividad se deslice con cada request real.
 *
 * Envuelta en React.cache(): dentro de una misma request (ej. el layout
 * autenticado y la pagina que renderiza adentro la llaman por separado),
 * las consultas a la base de datos se hacen una sola vez, no una por
 * cada llamada. Cada request nueva (otra navegacion, otro fetch desde el
 * cliente) sigue verificando todo de cero, asi que la deteccion de
 * cuentas bloqueadas/desactivadas sigue siendo inmediata.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;

  const [usuario, company] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.id },
      select: { activo: true, bloqueadoHasta: true, ultimoAccesoAt: true },
    }),
    prisma.company.findUnique({ where: { id: 1 }, select: { tiempoMaximoInactividadMin: true, cerrarSesionAutomaticamente: true } }),
  ]);

  if (!usuario || !usuario.activo) return null;
  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) return null;

  const limiteInactividad = company?.cerrarSesionAutomaticamente ? (company?.tiempoMaximoInactividadMin ?? 0) : 0;
  if (limiteInactividad > 0 && usuario.ultimoAccesoAt) {
    const minutosInactivo = (Date.now() - usuario.ultimoAccesoAt.getTime()) / 60000;
    if (minutosInactivo > limiteInactividad) return null;
  }

  await prisma.user.update({ where: { id: session.id }, data: { ultimoAccesoAt: new Date() } }).catch(() => {});

  return session;
});

export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS_DEFAULT;
