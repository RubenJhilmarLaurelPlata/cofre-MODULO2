// src/lib/usuarios.ts
// Estado derivado de un usuario (Modulo 7): Activo / Inactivo / Bloqueado.
// Un solo lugar de verdad para esta regla, usada tanto por la lista de
// usuarios como por el detalle.
import type { User } from '@prisma/client';

export type EstadoUsuario = 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO';

export function calcularEstadoUsuario(u: Pick<User, 'activo' | 'bloqueadoHasta'>): EstadoUsuario {
  if (!u.activo) return 'INACTIVO';
  if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) return 'BLOQUEADO';
  return 'ACTIVO';
}

export interface UsuarioDTO {
  id: string;
  username: string;
  nombre: string;
  role: string;
  estado: EstadoUsuario;
  bloqueadoHasta: string | null;
  ultimoAccesoAt: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
}

export function toUsuarioDTO(u: User): UsuarioDTO {
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    role: u.role,
    estado: calcularEstadoUsuario(u),
    bloqueadoHasta: u.bloqueadoHasta ? u.bloqueadoHasta.toISOString() : null,
    ultimoAccesoAt: u.ultimoAccesoAt ? u.ultimoAccesoAt.toISOString() : null,
    ultimoLoginAt: u.ultimoLoginAt ? u.ultimoLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}
