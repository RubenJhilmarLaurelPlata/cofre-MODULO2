// src/app/api/configuracion/usuarios/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, hashPassword } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { toUsuarioDTO, type EstadoUsuario } from '@/lib/usuarios';
import { ROLES } from '@/types';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  // SQLite corre con connection_limit=1 (ver .env.example): bajo una
  // rafaga real de escrituras concurrentes (varios lectores escaneando a
  // la vez), una consulta de lectura como esta puede agotar el tiempo de
  // espera del pool. Sin este try/catch, esa excepcion no capturada
  // producia una respuesta que no era JSON valido, y el frontend fallaba
  // con "Unexpected end of JSON input" en vez de un mensaje entendible.
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim();
    const role = url.searchParams.get('role')?.trim();
    const estado = url.searchParams.get('estado')?.trim() as EstadoUsuario | undefined;

    const usuarios = await prisma.user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(q ? { OR: [{ username: { contains: q } }, { nombre: { contains: q } }] } : {}),
      },
      orderBy: { nombre: 'asc' },
    });

    const dtos = usuarios.map(toUsuarioDTO).filter((u) => !estado || u.estado === estado);
    return NextResponse.json(dtos);
  } catch (err) {
    console.error('Error listando usuarios:', err);
    return NextResponse.json({ error: 'No se pudo consultar la lista de usuarios. Intenta de nuevo.' }, { status: 500 });
  }
}

const bodySchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'El usuario debe tener al menos 3 caracteres')
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Solo letras minúsculas, números, puntos, guiones'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').max(200),
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120),
  role: z.enum(ROLES),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  try {
    const existente = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    if (existente) {
      return NextResponse.json({ error: 'Ese nombre de usuario ya está en uso.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const nuevo = await prisma.user.create({
      data: { username: parsed.data.username, passwordHash, nombre: parsed.data.nombre, role: parsed.data.role },
    });

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'USUARIO_CREADO',
      modulo: 'usuarios',
      valorNuevo: { username: nuevo.username, nombre: nuevo.nombre, role: nuevo.role },
      ip,
      userAgent,
    });

    return NextResponse.json(toUsuarioDTO(nuevo));
  } catch (err) {
    console.error('Error creando usuario:', err);
    return NextResponse.json({ error: 'No se pudo crear el usuario. Intenta de nuevo.' }, { status: 500 });
  }
}
