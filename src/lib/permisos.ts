// src/lib/permisos.ts
// Sistema de permisos granular (Fase 2). Dos capas separadas a propósito:
//
// 1. El CATÁLOGO (qué permisos existen, con nombre y descripción legibles)
//    vive fijo en código, aquí abajo — solo cambia cuando se despliega
//    funcionalidad nueva, nunca algo que un administrador cree.
// 2. La ASIGNACIÓN (qué rol tiene qué permiso) vive en la base de datos
//    (RolePermiso), editable en caliente desde Configuración > Roles y
//    permisos — nunca un Record hardcodeado, porque eso no sería
//    realmente editable (ver auditoría de Fase 2).
//
// PERMISOS_POR_MODULO (src/types/index.ts) NO se reemplaza: sigue siendo
// el filtro grueso "¿puede este rol siquiera abrir este módulo?", usado
// por el middleware y el sidebar. Este catálogo es la capa fina de
// "¿puede ejecutar esta acción específica?", usada dentro de cada ruta.
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import type { Role, SessionUser } from '@/types';

export interface PermisoDef {
  key: string;
  modulo: string;
  nombre: string;
  descripcion: string;
}

// Grupos en el mismo orden en que deben mostrarse en la UI de
// administración de roles (Configuración > Roles y permisos).
export const GRUPOS_PERMISOS: Array<{ modulo: string; label: string }> = [
  { modulo: 'recepcion', label: 'Recepción' },
  { modulo: 'envios', label: 'Envíos' },
  { modulo: 'transferencias', label: 'Recepción de transferencias' },
  { modulo: 'deposito', label: 'Depósito' },
  { modulo: 'entrega', label: 'Entrega' },
  { modulo: 'buscador', label: 'Buscador' },
  { modulo: 'etiquetas', label: 'Etiquetas' },
  { modulo: 'finanzas', label: 'Finanzas' },
  { modulo: 'reportes', label: 'Reportes' },
  { modulo: 'admin', label: 'Administración' },
];

export const CATALOGO_PERMISOS: PermisoDef[] = [
  // Recepción
  { key: 'recepcion.registrar', modulo: 'recepcion', nombre: 'Registrar paquetes', descripcion: 'Permite escanear o ingresar manualmente un código para registrar un paquete recibido.' },
  { key: 'recepcion.ver', modulo: 'recepcion', nombre: 'Ver lotes activos', descripcion: 'Permite consultar los lotes de recepción en curso.' },

  // Envíos (Fase 2 — nuevo)
  { key: 'envios.ver', modulo: 'envios', nombre: 'Ver envíos', descripcion: 'Permite consultar la lista y el detalle de los envíos preparados.' },
  { key: 'envios.crear', modulo: 'envios', nombre: 'Crear envío', descripcion: 'Permite iniciar un nuevo envío hacia otra sucursal.' },
  { key: 'envios.agregar_paquete', modulo: 'envios', nombre: 'Agregar paquetes', descripcion: 'Permite incorporar paquetes a un envío mientras está en borrador.' },
  { key: 'envios.quitar_paquete', modulo: 'envios', nombre: 'Quitar paquetes', descripcion: 'Permite retirar un paquete de un envío antes de cerrarlo.' },
  { key: 'envios.cerrar', modulo: 'envios', nombre: 'Cerrar envío', descripcion: 'Permite cerrar un envío y dejarlo preparado e inmutable para transferencia.' },
  { key: 'envios.cancelar', modulo: 'envios', nombre: 'Cancelar envío', descripcion: 'Permite cancelar un envío antes de su salida, liberando sus paquetes.' },
  { key: 'envios.ver_qr', modulo: 'envios', nombre: 'Ver código QR', descripcion: 'Permite ver e imprimir el QR de un envío ya cerrado.' },

  // Recepción de transferencias — catalogado ahora, sin ningún endpoint
  // que lo consulte todavía: queda reservado para cuando exista
  // comunicación entre servidores (fase de conexión).
  { key: 'transferencias.ver', modulo: 'transferencias', nombre: 'Ver envíos entrantes', descripcion: 'Permite consultar los envíos que otra sucursal preparó hacia esta instalación. (Disponible cuando exista comunicación entre sucursales.)' },
  { key: 'transferencias.escanear_qr', modulo: 'transferencias', nombre: 'Escanear QR de envío', descripcion: 'Permite escanear el QR de un envío entrante para identificarlo. (Disponible cuando exista comunicación entre sucursales.)' },
  { key: 'transferencias.recibir', modulo: 'transferencias', nombre: 'Recibir envío', descripcion: 'Permite confirmar la recepción física de un envío entrante. (Disponible cuando exista comunicación entre sucursales.)' },
  { key: 'transferencias.confirmar', modulo: 'transferencias', nombre: 'Confirmar recepción', descripcion: 'Permite confirmar de vuelta hacia la sucursal de origen que el envío llegó. (Disponible cuando exista comunicación entre sucursales.)' },

  // Depósito
  { key: 'deposito.enviar', modulo: 'deposito', nombre: 'Enviar a depósito', descripcion: 'Permite mover paquetes de "En Paquetería" a "En Depósito".' },
  { key: 'deposito.bajar', modulo: 'deposito', nombre: 'Bajar de depósito', descripcion: 'Permite confirmar que un paquete pendiente ya fue bajado físicamente del depósito.' },
  { key: 'deposito.ver_pendientes', modulo: 'deposito', nombre: 'Ver pendientes de bajar', descripcion: 'Permite consultar los paquetes solicitados para bajar del depósito.' },

  // Entrega
  { key: 'entrega.buscar', modulo: 'entrega', nombre: 'Buscar paquetes', descripcion: 'Permite buscar un paquete por código para gestionar su entrega.' },
  { key: 'entrega.entregar', modulo: 'entrega', nombre: 'Entregar paquete', descripcion: 'Permite marcar un paquete como entregado y registrar su cobro.' },
  { key: 'entrega.denegar', modulo: 'entrega', nombre: 'Denegar paquete', descripcion: 'Permite anular un código registrado por error o que nunca ingresó realmente.' },
  { key: 'entrega.reingresar', modulo: 'entrega', nombre: 'Reingresar paquete', descripcion: 'Permite devolver a "En Paquetería" un paquete marcado como entregado por error.' },
  { key: 'entrega.solicitar_bajar_deposito', modulo: 'entrega', nombre: 'Solicitar bajar de depósito', descripcion: 'Permite solicitar que un paquete en depósito se baje a paquetería.' },
  { key: 'entrega.enviar_deposito', modulo: 'entrega', nombre: 'Enviar a depósito (desde Entrega)', descripcion: 'Permite enviar un paquete a depósito directamente desde la pantalla de Entrega.' },
  { key: 'entrega.excepcional', modulo: 'entrega', nombre: 'Entrega excepcional', descripcion: 'Permite entregar y cobrar un código que nunca pasó por Recepción, dejando registrado el motivo.' },
  { key: 'entrega.corregir', modulo: 'entrega', nombre: 'Corregir cobro', descripcion: 'Permite corregir el monto cobrado de una entrega ya realizada.' },

  // Buscador
  { key: 'buscador.buscar', modulo: 'buscador', nombre: 'Buscar paquetes', descripcion: 'Permite buscar paquetes por código, remitente, destinatario, estado o fecha.' },
  { key: 'buscador.ver_historial', modulo: 'buscador', nombre: 'Ver historial', descripcion: 'Permite ver el historial completo de un paquete.' },

  // Etiquetas
  { key: 'etiquetas.ver', modulo: 'etiquetas', nombre: 'Ver etiquetas', descripcion: 'Permite consultar los lotes de etiquetas generados y descargar sus PDF.' },
  { key: 'etiquetas.generar', modulo: 'etiquetas', nombre: 'Generar etiquetas', descripcion: 'Permite generar un lote nuevo de etiquetas en PDF.' },
  { key: 'etiquetas.reimprimir', modulo: 'etiquetas', nombre: 'Reimprimir etiquetas', descripcion: 'Permite volver a imprimir códigos ya generados.' },
  { key: 'etiquetas.eliminar_lote', modulo: 'etiquetas', nombre: 'Eliminar lote', descripcion: 'Permite eliminar un lote de etiquetas generado por error, siempre que ningún código se haya usado.' },
  { key: 'etiquetas.configurar_meses', modulo: 'etiquetas', nombre: 'Configurar letras de mes', descripcion: 'Permite cambiar la letra asignada a cada mes del año para armar los códigos.' },

  // Finanzas
  { key: 'finanzas.ver_caja', modulo: 'finanzas', nombre: 'Ver caja', descripcion: 'Permite ver el resumen financiero, la caja y sus movimientos.' },
  { key: 'finanzas.registrar_cobros', modulo: 'finanzas', nombre: 'Registrar/corregir cobros', descripcion: 'Permite registrar pagos y corregir cobros de paquetes.' },
  { key: 'finanzas.registrar_gastos', modulo: 'finanzas', nombre: 'Registrar gastos', descripcion: 'Permite registrar gastos operativos.' },
  { key: 'finanzas.cerrar_caja', modulo: 'finanzas', nombre: 'Abrir/cerrar caja', descripcion: 'Permite abrir y cerrar la sesión de caja del día.' },

  // Reportes
  { key: 'reportes.ver', modulo: 'reportes', nombre: 'Ver reportes', descripcion: 'Permite consultar los reportes de paquetes, financieros, de operadores, depósito y etiquetas.' },
  { key: 'reportes.exportar', modulo: 'reportes', nombre: 'Exportar reportes', descripcion: 'Permite descargar reportes en PDF, Excel o CSV.' },

  // Administración
  { key: 'admin.usuarios', modulo: 'admin', nombre: 'Administrar usuarios', descripcion: 'Permite crear, editar, bloquear y eliminar usuarios.' },
  { key: 'admin.roles', modulo: 'admin', nombre: 'Administrar roles y permisos', descripcion: 'Permite ver y editar qué puede hacer cada rol, y personalizar permisos por usuario.' },
  { key: 'admin.config_empresa', modulo: 'admin', nombre: 'Configurar empresa e instalación', descripcion: 'Permite editar los datos de la empresa y la identidad de esta instalación (sucursal).' },
  { key: 'admin.destinos', modulo: 'admin', nombre: 'Administrar destinos', descripcion: 'Permite crear y editar las sucursales a las que esta instalación puede enviar paquetes.' },
  { key: 'admin.tarifas', modulo: 'admin', nombre: 'Configurar tarifas', descripcion: 'Permite editar la tarifa base, días incluidos y costo adicional de esta instalación.' },
  { key: 'admin.feriados', modulo: 'admin', nombre: 'Administrar feriados', descripcion: 'Permite agregar, modificar o eliminar feriados.' },
  { key: 'admin.series', modulo: 'admin', nombre: 'Administrar series de código', descripcion: 'Permite configurar las iniciales/series de código de paquete.' },
  { key: 'admin.importacion', modulo: 'admin', nombre: 'Importar datos', descripcion: 'Permite importar archivos masivos de códigos y revertir importaciones.' },
  { key: 'admin.auditoria', modulo: 'admin', nombre: 'Ver auditoría', descripcion: 'Permite consultar el registro de auditoría del sistema.' },
  { key: 'admin.respaldos', modulo: 'admin', nombre: 'Administrar respaldos', descripcion: 'Permite crear y descargar respaldos de la base de datos.' },
];

const CATALOGO_POR_KEY = new Map(CATALOGO_PERMISOS.map((p) => [p.key, p]));
export type PermisoKey = string;

export function getPermisoDef(key: string): PermisoDef | undefined {
  return CATALOGO_POR_KEY.get(key);
}

/**
 * Permisos asignados a un rol, leídos de RolePermiso (fuente de verdad
 * real y editable — nunca un Record en memoria). Envuelta en
 * React.cache(): dentro de la misma request, tienePermiso() puede
 * llamarse varias veces para el mismo rol sin repetir la consulta —
 * mismo criterio que getCompanyConfig()/getSession(). Cada request nueva
 * vuelve a leer de la base, así que un cambio del administrador se
 * refleja de inmediato en la siguiente request, nunca hay que esperar a
 * que expire el JWT.
 */
export const getPermisosDeRol = cache(async (role: Role): Promise<Set<string>> => {
  const filas = await prisma.rolePermiso.findMany({ where: { role }, select: { permiso: true } });
  return new Set(filas.map((f) => f.permiso));
});

interface UsuarioConPermisos {
  role: Role;
  permisosExtra?: string | null;
  permisosRevocados?: string | null;
}

function parseListaPermisos(json: string | null | undefined): Set<string> {
  if (!json) return new Set();
  try {
    const valor = JSON.parse(json);
    return Array.isArray(valor) ? new Set(valor.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Resuelve si un usuario tiene un permiso: (permisos de su rol + sus
 * excepciones agregadas) menos sus excepciones revocadas. Los usuarios
 * sin ninguna excepción (permisosExtra/permisosRevocados en null — el
 * estado de todo usuario existente hoy) se resuelven exclusivamente por
 * su rol, sin ninguna diferencia de comportamiento.
 */
export async function tienePermiso(user: UsuarioConPermisos, permiso: string): Promise<boolean> {
  const base = await getPermisosDeRol(user.role);
  const extra = parseListaPermisos(user.permisosExtra);
  const revocados = parseListaPermisos(user.permisosRevocados);
  return (base.has(permiso) || extra.has(permiso)) && !revocados.has(permiso);
}

/** Vista completa (rol / extra / revocado / efectivo) para la UI de "Personalizar permisos" de un usuario. */
export async function getPermisosEfectivos(user: UsuarioConPermisos): Promise<Array<{ key: string; deRol: boolean; extra: boolean; revocado: boolean; efectivo: boolean }>> {
  const base = await getPermisosDeRol(user.role);
  const extra = parseListaPermisos(user.permisosExtra);
  const revocados = parseListaPermisos(user.permisosRevocados);
  return CATALOGO_PERMISOS.map((p) => {
    const deRol = base.has(p.key);
    const permisoExtra = extra.has(p.key);
    const revocado = revocados.has(p.key);
    return { key: p.key, deRol, extra: permisoExtra, revocado, efectivo: (deRol || permisoExtra) && !revocado };
  });
}

/**
 * SessionUser no trae permisosExtra/permisosRevocados (el JWT no los
 * incluye, para no tener que re-firmar la sesión cada vez que un admin
 * cambia una excepción individual — mismo motivo por el que getSession()
 * ya vuelve a consultar activo/bloqueadoHasta en la base en cada
 * request). tienePermisoSesion() hace esa lectura fresca antes de
 * resolver, para que un cambio de excepciones sea efectivo de inmediato,
 * igual que un cambio de rol de RolePermiso.
 */
export const getUsuarioConPermisos = cache(async (userId: string): Promise<UsuarioConPermisos | null> => {
  return prisma.user.findUnique({ where: { id: userId }, select: { role: true, permisosExtra: true, permisosRevocados: true } }) as Promise<UsuarioConPermisos | null>;
});

export async function tienePermisoSesion(session: SessionUser, permiso: string): Promise<boolean> {
  const usuario = await getUsuarioConPermisos(session.id);
  if (!usuario) return false;
  return tienePermiso(usuario, permiso);
}
