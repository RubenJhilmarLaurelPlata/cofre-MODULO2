// src/types/index.ts
//
// Role y PackageStatus se definen AQUI a mano, no se importan de
// "@prisma/client", porque SQLite no soporta enums nativos de base de
// datos: en el schema de Prisma esos campos son String (ver el
// comentario en prisma/schema.prisma). Este es el UNICO lugar del
// proyecto donde se definen estos dos conjuntos de valores; todo lo
// demas los importa de aqui.

export const ROLES = ['ADMIN', 'SUPERVISOR', 'RECEPCION', 'ENTREGA', 'CONSULTA', 'ADMIN_CAJA'] as const;
export type Role = (typeof ROLES)[number];

export const PACKAGE_STATUSES = ['EN_PAQUETERIA', 'EN_DEPOSITO', 'PENDIENTE_BAJAR', 'ENTREGADO', 'DENEGADO'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDIENTE', 'PARCIAL', 'PAGADO'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Motivo de una entrega excepcional (ver entregaExcepcional() en
// src/lib/package-transitions.ts): opciones estructuradas, no texto
// libre — el motivo es trazabilidad de por que se omitio Recepcion,
// nunca una decision sobre si corresponde cobrar. "OTRO" es la unica que
// admite un detalle libre adicional. Aqui (no en package-transitions.ts,
// que usa Prisma) porque tanto el frontend ('use client') como el
// backend necesitan el mismo conjunto de valores.
export const MOTIVOS_ENTREGA_EXCEPCIONAL = ['NO_REGISTRADO_AL_INGRESAR', 'ERROR_DE_REGISTRO', 'AUTORIZACION_ADMINISTRATIVA', 'OTRO'] as const;
export type MotivoEntregaExcepcional = (typeof MOTIVOS_ENTREGA_EXCEPCIONAL)[number];

export const MOTIVO_ENTREGA_EXCEPCIONAL_LABEL: Record<MotivoEntregaExcepcional, string> = {
  NO_REGISTRADO_AL_INGRESAR: 'No se registró al ingresar',
  ERROR_DE_REGISTRO: 'Error de registro',
  AUTORIZACION_ADMINISTRATIVA: 'Autorización administrativa',
  OTRO: 'Otro',
};

/** Lo que guardamos dentro del JWT y devolvemos como "sesion" en el servidor. */
export interface SessionUser {
  id: string;
  username: string;
  nombre: string;
  role: Role;
  branchId: string | null;
}

/**
 * Cada seccion del sistema y que roles pueden entrar a ella.
 *
 * ADMIN_CAJA (Administrador de Caja) hace recepcion + entrega del dia a
 * dia: entra a recepcion/entrega/deposito/buscador, pero NUNCA a
 * dashboard, finanzas (gastos/cierre de caja), reportes o configuracion
 * — esos siguen siendo exclusivos de ADMIN (y, donde ya aplicaba,
 * SUPERVISOR). No agregarlo a esos modulos es intencional.
 */
export const PERMISOS_POR_MODULO = {
  dashboard: ['ADMIN', 'SUPERVISOR', 'RECEPCION', 'ENTREGA', 'CONSULTA'],
  recepcion: ['ADMIN', 'RECEPCION', 'ADMIN_CAJA'],
  // Fase 2: filtro grueso "¿puede este rol abrir el módulo?" — quién
  // puede ejecutar cada acción puntual (crear/agregar/cerrar/cancelar) lo
  // decide el catálogo granular de src/lib/permisos.ts (RolePermiso),
  // consultado dentro de cada ruta.
  envios: ['ADMIN', 'RECEPCION', 'ADMIN_CAJA'],
  entrega: ['ADMIN', 'ENTREGA', 'ADMIN_CAJA'],
  deposito: ['ADMIN', 'ENTREGA', 'RECEPCION', 'ADMIN_CAJA'],
  buscador: ['ADMIN', 'SUPERVISOR', 'ENTREGA', 'CONSULTA', 'ADMIN_CAJA'],
  etiquetas: ['ADMIN', 'RECEPCION'],
  reportes: ['ADMIN', 'SUPERVISOR'],
  finanzas: ['ADMIN', 'SUPERVISOR'],
  importacion: ['ADMIN'],
  configuracion: ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Modulo = keyof typeof PERMISOS_POR_MODULO;

export function puedeAcceder(role: Role, modulo: Modulo): boolean {
  return (PERMISOS_POR_MODULO[modulo] as readonly Role[]).includes(role);
}

/**
 * Orden de preferencia para elegir a donde mandar a un usuario recien
 * logueado (o rebotado por falta de permiso). No todos los roles tienen
 * acceso a "dashboard" (ej. ADMIN_CAJA) — redirigir ahi sin verificar
 * causaba un loop infinito de redirects (dashboard -> sin permiso ->
 * dashboard -> sin permiso -> ...). Esta funcion siempre devuelve el
 * primer modulo al que el rol SI tiene acceso, nunca uno prohibido.
 */
const ORDEN_MODULOS_PREFERIDO: readonly Modulo[] = [
  'dashboard',
  'recepcion',
  'envios',
  'entrega',
  'deposito',
  'buscador',
  'etiquetas',
  'reportes',
  'finanzas',
  'importacion',
  'configuracion',
];

export function moduloInicialPara(role: Role): Modulo | null {
  return ORDEN_MODULOS_PREFERIDO.find((modulo) => puedeAcceder(role, modulo)) ?? null;
}

/** Etiquetas legibles de cada rol, para mostrar en la interfaz. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  RECEPCION: 'Recepción',
  ENTREGA: 'Entrega',
  CONSULTA: 'Consulta',
  ADMIN_CAJA: 'Administrador de Caja',
};
