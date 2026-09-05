// src/app/api/auth/login/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signSession, esRequestSegura, SESSION_COOKIE } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import type { Role } from '@/types';

const bodySchema = z.object({
  username: z.string().min(1, 'El usuario es requerido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Usuario y contraseña son requeridos' }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const { ip, userAgent } = extraerContextoRequest(req);

  // Sin este try/catch, cualquier excepcion no capturada aqui (ej. SQLite
  // con connection_limit=1, ver .env.example, agotando el pool bajo carga
  // concurrente real) devolvia una respuesta que no era JSON valido — el
  // formulario de login hacia response.json() sin comprobarlo antes y
  // fallaba con "Unexpected end of JSON input" en vez de mostrar un
  // mensaje entendible.
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.activo) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }

    const company = await getCompanyConfig();

    // Bloqueo vigente (manual del administrador o automatico por intentos fallidos): rechazar sin ni siquiera revisar la contraseña.
    if (user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      const minutosRestantes = Math.ceil((user.bloqueadoHasta.getTime() - Date.now()) / 60000);
      await registrarAuditoria({ userId: user.id, accion: 'LOGIN_BLOQUEADO', modulo: 'auth', valorNuevo: { username }, ip, userAgent });
      return NextResponse.json(
        { error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutosRestantes} minuto${minutosRestantes === 1 ? '' : 's'}.` },
        { status: 423 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const intentos = user.intentosFallidos + 1;
      const debeBloquear = intentos >= company.maxIntentosLogin;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          intentosFallidos: debeBloquear ? 0 : intentos,
          bloqueadoHasta: debeBloquear ? new Date(Date.now() + company.tiempoBloqueoMin * 60000) : user.bloqueadoHasta,
        },
      });
      await registrarAuditoria({
        userId: user.id,
        accion: debeBloquear ? 'USUARIO_BLOQUEADO' : 'LOGIN_FALLIDO',
        modulo: 'auth',
        valorNuevo: { username, intentos },
        ip,
        userAgent,
      });
      if (debeBloquear) {
        return NextResponse.json(
          { error: `Demasiados intentos fallidos. Cuenta bloqueada por ${company.tiempoBloqueoMin} minutos.` },
          { status: 423 }
        );
      }
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }

    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { ultimoAccesoAt: now, ultimoLoginAt: now, intentosFallidos: 0, bloqueadoHasta: null },
    });

    const sessionUser = {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      role: user.role as Role,
      branchId: user.branchId,
    };

    const duracionSegundos = company.tiempoMaximoSesionMin * 60;
    const token = await signSession(sessionUser, duracionSegundos);

    await registrarAuditoria({ userId: user.id, accion: 'LOGIN', modulo: 'auth', ip, userAgent });

    const res = NextResponse.json({ ok: true, user: sessionUser });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: esRequestSegura(req),
      sameSite: 'lax',
      path: '/',
      maxAge: duracionSegundos,
    });
    return res;
  } catch (err) {
    console.error('Error en login:', err);
    return NextResponse.json({ error: 'No se pudo iniciar sesión. Intenta de nuevo en unos segundos.' }, { status: 500 });
  }
}
