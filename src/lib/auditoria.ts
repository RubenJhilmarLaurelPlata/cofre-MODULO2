// src/lib/auditoria.ts
// Registro general de auditoria (Modulo 7): quien hizo que, en que
// modulo, con que valores antes/despues. Se usa desde rutas ya
// existentes (login, recepcion, entrega, deposito, etiquetas, reportes)
// ademas de las nuevas de Configuracion. Nunca debe romper la accion
// principal si el registro falla, por eso siempre atrapa sus propios
// errores.

import { prisma } from '@/lib/prisma';
import type { Prisma, AuditLog } from '@prisma/client';

export interface RegistrarAuditoriaParams {
  userId?: string | null;
  accion: string;
  modulo: string;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function registrarAuditoria(params: RegistrarAuditoriaParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        accion: params.accion,
        modulo: params.modulo,
        valorAnterior: params.valorAnterior !== undefined ? JSON.stringify(params.valorAnterior) : null,
        valorNuevo: params.valorNuevo !== undefined ? JSON.stringify(params.valorNuevo) : null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('No se pudo registrar la auditoría:', err);
  }
}

/** Extrae IP y user-agent de una request de Next.js, cuando esten disponibles (ej. detras de un proxy). */
export function extraerContextoRequest(req: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]?.trim() ?? null : req.headers.get('x-real-ip');
  return { ip, userAgent: req.headers.get('user-agent') };
}

export interface AuditLogDTO {
  id: string;
  usuario: string;
  ip: string | null;
  userAgent: string | null;
  accion: string;
  modulo: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  createdAt: string;
}

function parseJsonSeguro(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function toAuditLogDTO(l: AuditLog & { user: { nombre: string } | null }): AuditLogDTO {
  return {
    id: l.id,
    usuario: l.user?.nombre ?? 'Sistema',
    ip: l.ip,
    userAgent: l.userAgent,
    accion: l.accion,
    modulo: l.modulo,
    valorAnterior: parseJsonSeguro(l.valorAnterior),
    valorNuevo: parseJsonSeguro(l.valorNuevo),
    createdAt: l.createdAt.toISOString(),
  };
}

export interface FiltrosAuditoria {
  q?: string;
  modulo?: string;
  accion?: string;
  usuarioId?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
}

/** Busca y filtra el historial de auditoria: usado por la pantalla de Auditoria del Modulo 7. */
export async function buscarAuditoria(filtros: FiltrosAuditoria): Promise<AuditLogDTO[]> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filtros.modulo) where.modulo = filtros.modulo;
  if (filtros.accion) where.accion = filtros.accion;
  if (filtros.usuarioId) where.userId = filtros.usuarioId;

  if (filtros.desde || filtros.hasta) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filtros.desde) createdAt.gte = new Date(`${filtros.desde}T00:00:00`);
    if (filtros.hasta) {
      const fin = new Date(`${filtros.hasta}T00:00:00`);
      fin.setDate(fin.getDate() + 1);
      createdAt.lt = fin;
    }
    where.createdAt = createdAt;
  }

  if (filtros.q) {
    where.OR = [
      { accion: { contains: filtros.q } },
      { modulo: { contains: filtros.q } },
      { valorAnterior: { contains: filtros.q } },
      { valorNuevo: { contains: filtros.q } },
      { user: { nombre: { contains: filtros.q } } },
    ];
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filtros.limit ?? 200,
    include: { user: { select: { nombre: true } } },
  });

  return logs.map(toAuditLogDTO);
}

/**
 * Centro de notificaciones (Modulo 7): en vez de una tabla nueva, es una
 * vista filtrada del mismo AuditLog para los tipos de evento que
 * realmente ameritan una notificacion (nunca se duplica el dato).
 */
const ACCIONES_NOTIFICABLES = [
  'LOGIN_FALLIDO',
  'LOGIN_BLOQUEADO',
  'USUARIO_BLOQUEADO',
  'USUARIO_BLOQUEADO_MANUAL',
  'RESPALDO_CREADO',
  'RESPALDO_ERROR',
  'CONFIGURACION_EMPRESA_ACTUALIZADA',
  'TARIFAS_ACTUALIZADAS',
  'SEGURIDAD_ACTUALIZADA',
  'PREFERENCIAS_ACTUALIZADAS',
];

export async function getNotificaciones(limit = 50): Promise<AuditLogDTO[]> {
  const logs = await prisma.auditLog.findMany({
    where: { accion: { in: ACCIONES_NOTIFICABLES } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { nombre: true } } },
  });
  return logs.map(toAuditLogDTO);
}
