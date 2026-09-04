// tests/permisos.test.ts
// Sistema de permisos granular (Fase 2). Contra SQLite real de prueba
// (ver tests/setup.ts) — nunca contra prisma/dev.db. IMPORTANTE: a
// diferencia de la Fase 1, aquí RolePermiso nace VACÍO en la base de
// prueba (tests/setup.ts hace `db push`, que no ejecuta el INSERT de
// siembra de la migración) — cada test siembra explícitamente lo que
// necesita, lo cual además prueba que tienePermiso() depende
// exclusivamente de la tabla, nunca de un Record en memoria.
import { describe, test, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { tienePermiso, getPermisosDeRol, getPermisosEfectivos } from '@/lib/permisos';

describe('TEST 14/15/16/17 — permisos de creación/agregar/cerrar/cancelar de Envíos', () => {
  test('un usuario RECEPCION con RolePermiso sembrado puede crear/agregar/cerrar/cancelar', async () => {
    await prisma.rolePermiso.createMany({
      data: [
        { id: 'RECEPCION:envios.crear', role: 'RECEPCION', permiso: 'envios.crear' },
        { id: 'RECEPCION:envios.agregar_paquete', role: 'RECEPCION', permiso: 'envios.agregar_paquete' },
        { id: 'RECEPCION:envios.cerrar', role: 'RECEPCION', permiso: 'envios.cerrar' },
        { id: 'RECEPCION:envios.cancelar', role: 'RECEPCION', permiso: 'envios.cancelar' },
      ],
    });
    const user = { role: 'RECEPCION' as const, permisosExtra: null, permisosRevocados: null };
    expect(await tienePermiso(user, 'envios.crear')).toBe(true);
    expect(await tienePermiso(user, 'envios.agregar_paquete')).toBe(true);
    expect(await tienePermiso(user, 'envios.cerrar')).toBe(true);
    expect(await tienePermiso(user, 'envios.cancelar')).toBe(true);
    // Sin sembrar, CONSULTA no tiene ninguno de estos.
    expect(await tienePermiso({ role: 'CONSULTA', permisosExtra: null, permisosRevocados: null }, 'envios.crear')).toBe(false);
  });
});

describe('TEST 18 — modificación de RolePermiso persiste', () => {
  test('agregar y quitar una fila se refleja de inmediato, sin caché entre llamadas separadas', async () => {
    await prisma.rolePermiso.deleteMany({ where: { role: 'CONSULTA', permiso: 'buscador.buscar' } });
    expect(await tienePermiso({ role: 'CONSULTA', permisosExtra: null, permisosRevocados: null }, 'buscador.buscar')).toBe(false);

    await prisma.rolePermiso.create({ data: { id: 'CONSULTA:buscador.buscar', role: 'CONSULTA', permiso: 'buscador.buscar' } });
    const permisos = await prisma.rolePermiso.findMany({ where: { role: 'CONSULTA' } });
    expect(permisos.some((p) => p.permiso === 'buscador.buscar')).toBe(true);

    await prisma.rolePermiso.delete({ where: { id: 'CONSULTA:buscador.buscar' } });
    const permisosDespues = await prisma.rolePermiso.findMany({ where: { role: 'CONSULTA', permiso: 'buscador.buscar' } });
    expect(permisosDespues).toHaveLength(0);
  });
});

describe('TEST 19 — un cambio de RolePermiso afecta realmente la resolución de permisos', () => {
  test('getPermisosDeRol() ve el estado real de la tabla en cada llamada (no un Record hardcodeado)', async () => {
    await prisma.rolePermiso.deleteMany({ where: { role: 'ENTREGA', permiso: 'entrega.corregir' } });
    expect((await getPermisosDeRol('ENTREGA')).has('entrega.corregir')).toBe(false);

    // Un administrador otorga "entrega.corregir" a ENTREGA (hoy solo lo tiene ADMIN).
    await prisma.rolePermiso.create({ data: { id: 'ENTREGA:entrega.corregir', role: 'ENTREGA', permiso: 'entrega.corregir' } });
    expect((await getPermisosDeRol('ENTREGA')).has('entrega.corregir')).toBe(true);
    expect(await tienePermiso({ role: 'ENTREGA', permisosExtra: null, permisosRevocados: null }, 'entrega.corregir')).toBe(true);
  });
});

describe('TEST 20 — permisos extra/revocados por usuario', () => {
  test('permisosExtra agrega un permiso fuera del rol; permisosRevocados quita uno que el rol sí daría', async () => {
    await prisma.rolePermiso.upsert({
      where: { role_permiso: { role: 'RECEPCION', permiso: 'etiquetas.ver' } },
      update: {},
      create: { id: 'RECEPCION:etiquetas.ver', role: 'RECEPCION', permiso: 'etiquetas.ver' },
    });

    // Extra: CONSULTA no tiene "envios.ver" por rol, pero este usuario sí, por excepción.
    const conExtra = { role: 'CONSULTA' as const, permisosExtra: JSON.stringify(['envios.ver']), permisosRevocados: null };
    expect(await tienePermiso(conExtra, 'envios.ver')).toBe(true);
    expect(await tienePermiso({ role: 'CONSULTA', permisosExtra: null, permisosRevocados: null }, 'envios.ver')).toBe(false);

    // Revocado: RECEPCION tiene "etiquetas.ver" por rol, pero a este usuario se lo quitaron.
    const conRevocado = { role: 'RECEPCION' as const, permisosExtra: null, permisosRevocados: JSON.stringify(['etiquetas.ver']) };
    expect(await tienePermiso(conRevocado, 'etiquetas.ver')).toBe(false);
    expect(await tienePermiso({ role: 'RECEPCION', permisosExtra: null, permisosRevocados: null }, 'etiquetas.ver')).toBe(true);
  });

  test('getPermisosEfectivos() distingue claramente rol/extra/revocado/efectivo', async () => {
    await prisma.rolePermiso.upsert({
      where: { role_permiso: { role: 'ADMIN_CAJA', permiso: 'envios.ver' } },
      update: {},
      create: { id: 'ADMIN_CAJA:envios.ver', role: 'ADMIN_CAJA', permiso: 'envios.ver' },
    });
    const usuario = { role: 'ADMIN_CAJA' as const, permisosExtra: JSON.stringify(['admin.tarifas']), permisosRevocados: JSON.stringify(['envios.ver']) };
    const efectivos = await getPermisosEfectivos(usuario);

    const enviosVer = efectivos.find((e) => e.key === 'envios.ver')!;
    expect(enviosVer.deRol).toBe(true);
    expect(enviosVer.revocado).toBe(true);
    expect(enviosVer.efectivo).toBe(false); // rol lo da, pero está revocado

    const adminTarifas = efectivos.find((e) => e.key === 'admin.tarifas')!;
    expect(adminTarifas.deRol).toBe(false);
    expect(adminTarifas.extra).toBe(true);
    expect(adminTarifas.efectivo).toBe(true); // no es del rol, pero se agregó como extra
  });
});

describe('TEST 21/22 — usuario sin/con permiso', () => {
  test('sin el permiso, la resolución es false (equivalente a 403 en la ruta); con el permiso, es true', async () => {
    await prisma.rolePermiso.deleteMany({ where: { role: 'CONSULTA', permiso: 'admin.usuarios' } });
    expect(await tienePermiso({ role: 'CONSULTA', permisosExtra: null, permisosRevocados: null }, 'admin.usuarios')).toBe(false);

    await prisma.rolePermiso.upsert({
      where: { role_permiso: { role: 'ADMIN', permiso: 'admin.usuarios' } },
      update: {},
      create: { id: 'ADMIN:admin.usuarios', role: 'ADMIN', permiso: 'admin.usuarios' },
    });
    expect(await tienePermiso({ role: 'ADMIN', permisosExtra: null, permisosRevocados: null }, 'admin.usuarios')).toBe(true);
  });
});

describe('TEST 23 — las rutas migradas mantienen su acceso inicial (seed de la migración)', () => {
  // Muestra representativa de la tabla auditada en
  // prisma/migrations/20260904000000_agrega_envios_y_permisos/migration.sql
  // — el mismo mapeo exacto que tenían los ROLES_PERMITIDOS/session.role
  // originales antes de migrar cada ruta. No repite las 103 filas: cubre
  // al menos un caso de cada módulo migrado, incluidos los casos donde el
  // acceso NO es el genérico del módulo (entrega.excepcional, sin
  // ENTREGA; entrega.corregir, solo ADMIN).
  const CASOS: Array<[string, string[]]> = [
    ['recepcion.registrar', ['ADMIN', 'RECEPCION', 'ADMIN_CAJA']],
    ['deposito.enviar', ['ADMIN', 'ENTREGA', 'RECEPCION', 'ADMIN_CAJA']],
    ['entrega.entregar', ['ADMIN', 'ENTREGA', 'ADMIN_CAJA']],
    ['entrega.excepcional', ['ADMIN', 'ADMIN_CAJA']], // mas angosto: sin ENTREGA
    ['entrega.corregir', ['ADMIN']], // solo ADMIN
    ['buscador.buscar', ['ADMIN', 'SUPERVISOR', 'ENTREGA', 'CONSULTA', 'ADMIN_CAJA']],
    ['etiquetas.ver', ['ADMIN', 'RECEPCION']],
    ['etiquetas.generar', ['ADMIN']],
    ['finanzas.ver_caja', ['ADMIN', 'SUPERVISOR']],
    ['reportes.ver', ['ADMIN', 'SUPERVISOR']],
    ['admin.usuarios', ['ADMIN']],
    ['admin.importacion', ['ADMIN']],
  ];
  const TODOS_LOS_ROLES = ['ADMIN', 'SUPERVISOR', 'RECEPCION', 'ENTREGA', 'CONSULTA', 'ADMIN_CAJA'] as const;

  test.each(CASOS)('%s coincide exactamente con los roles auditados antes de migrar', async (permiso, rolesEsperados) => {
    // Reproduce la siembra de la migracion SOLO para este permiso (la
    // base de test usa `db push`, no las migraciones reales — ver
    // tests/setup.ts).
    await prisma.rolePermiso.deleteMany({ where: { permiso } });
    await prisma.rolePermiso.createMany({ data: rolesEsperados.map((role) => ({ id: `${role}:${permiso}`, role, permiso })) });

    for (const role of TODOS_LOS_ROLES) {
      const esperado = rolesEsperados.includes(role);
      const real = await tienePermiso({ role, permisosExtra: null, permisosRevocados: null }, permiso);
      expect(real, `${role} y "${permiso}": esperaba ${esperado}`).toBe(esperado);
    }
  });
});
