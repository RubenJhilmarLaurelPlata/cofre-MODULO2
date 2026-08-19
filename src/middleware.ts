// src/middleware.ts
// Corre en el runtime Edge de Next.js: por eso verifica el JWT con "jose"
// (no usa Prisma ni bcrypt aqui, esas librerias requieren Node runtime).

import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { PERMISOS_POR_MODULO, moduloInicialPara, type Modulo, type Role } from '@/types';
import { SESSION_COOKIE } from '@/lib/session-cookie';

const RUTAS_PUBLICAS = ['/login'];

function esModuloValido(segmento: string): segmento is Modulo {
  return segmento in PERMISOS_POR_MODULO;
}

async function verificarSesion(token: string | undefined) {
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload as { id: string; username: string; nombre: string; role: Role; branchId: string | null };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (RUTAS_PUBLICAS.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verificarSesion(token);

  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Para paginas, el modulo es el primer segmento (/recepcion -> "recepcion").
  // Para rutas de API, el modulo esta en el SEGUNDO segmento
  // (/api/recepcion/scan -> "recepcion"), asi que las protegemos igual
  // que a su pagina correspondiente sin tener que repetir la logica en
  // cada route handler.
  const segmentos = pathname.split('/').filter(Boolean);
  const candidato = segmentos[0] === 'api' ? segmentos[1] ?? '' : segmentos[0] ?? '';

  if (esModuloValido(candidato) && !(PERMISOS_POR_MODULO[candidato] as readonly Role[]).includes(session.role)) {
    if (segmentos[0] === 'api') {
      return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
    }
    // Nunca redirigir a un modulo fijo (ej. "/dashboard"): si el rol tampoco
    // tiene acceso a ese destino, el middleware lo volveria a rechazar y se
    // forma un loop infinito (asi se producia ERR_TOO_MANY_REDIRECTS para
    // roles como ADMIN_CAJA, que no tiene acceso a dashboard). Se redirige
    // siempre al primer modulo que el rol SI puede usar.
    const destino = moduloInicialPara(session.role);
    if (!destino || destino === candidato) {
      // No hay ningun modulo accesible para este rol (no deberia ocurrir
      // con los roles actuales, pero evita cualquier loop si pasara): se
      // cierra la sesion y se manda a login en vez de rebotar sin salida.
      const loginUrl = new URL('/login', req.url);
      const res = NextResponse.redirect(loginUrl);
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    return NextResponse.redirect(new URL(`/${destino}?error=sin-permiso`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Aplica el middleware a todo excepto:
     * - archivos estaticos (_next/static, _next/image)
     * - favicon
     * - rutas de la API de autenticacion (login/logout, publicas por diseño)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
};
