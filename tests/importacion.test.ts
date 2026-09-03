// tests/importacion.test.ts
// Pruebas de integración (contra SQLite real, ver tests/setup.ts) para el
// flujo de Importación auditado: fecha operativa vs. fecha técnica,
// movimientos financieros, idempotencia, progreso real, aislamiento de
// errores por fila, y reversión de un lote. Cubre los 9 escenarios
// pedidos en la auditoría (sección "Pruebas automatizadas").
import { describe, test, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  validarFilas,
  ejecutarImportacion,
  crearImportLogInicial,
  finalizarImportLog,
  crearPaquetesFaltantes,
  revertirLoteImportacion,
  LoteYaRevertidoError,
  type FilaImportacion,
  type OpcionesFechaRecepcion,
  type TipoImportacion,
  type OnProgreso,
} from '@/lib/importacion';

let branchId: string;
let userId: string;

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba' } });
  branchId = branch.id;
  const user = await prisma.user.create({
    data: { username: 'admin-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId },
  });
  userId = user.id;
  // getCompanyConfig() crea la fila con los defaults reales del sistema si
  // no existe (tarifaBase Bs2, 4 días incluidos, Bs1/día adicional) —
  // mismos valores que documenta CLAUDE.md como configuración inicial.
  await prisma.company.create({ data: { id: 1 } });
});

function filasDesde(codigos: string[], extra?: Partial<FilaImportacion>): FilaImportacion[] {
  return codigos.map((codigo, i) => ({ numeroFila: i + 2, codigo, ...extra }));
}

async function importar(codigos: string[], opts: { opcionesFecha?: OpcionesFechaRecepcion; tipo: TipoImportacion; extra?: Partial<FilaImportacion>; onProgreso?: OnProgreso }) {
  const filas = filasDesde(codigos, opts.extra);
  const resumen = await validarFilas(filas, opts.opcionesFecha, 2);
  const importLogId = await crearImportLogInicial({ nombreArchivo: 'test.xlsx', formato: 'XLSX', resumen, tipo: opts.tipo, userId });
  const resultado = await ejecutarImportacion(resumen, opts.tipo, userId, branchId, 2, { importLogId, onProgreso: opts.onProgreso });
  await finalizarImportLog({ importLogId, nombreArchivo: 'test.xlsx', resumen, resultado, userId });
  return { resumen, resultado, importLogId };
}

describe('TEST 1/3 — fecha global respeta la fecha operativa (recepción Y entrega)', () => {
  test('Crear faltantes y entregar con fecha única: ingresoAt y entregaAt quedan en la fecha elegida, no en "hoy"', async () => {
    const codigos = ['DTA-1', 'DTA-2', 'DTA-3'];
    const { resultado } = await importar(codigos, { opcionesFecha: { modo: 'unica', fechaUnica: '2026-08-27' }, tipo: 'CREAR_Y_ENTREGAR' });
    expect(resultado.creados).toBe(3);
    expect(resultado.entregados).toBe(3);
    expect(resultado.conError).toBe(0);

    const paquetes = await prisma.package.findMany({ where: { code: { in: codigos } } });
    expect(paquetes).toHaveLength(3);
    for (const pkg of paquetes) {
      expect(pkg.status).toBe('ENTREGADO');
      expect(pkg.ingresoAt.toISOString().slice(0, 10)).toBe('2026-08-27');
      // La causa raíz del bug auditado: entregaAt caía en "hoy" cuando el
      // archivo no traía una columna de "fecha de entrega" propia.
      expect(pkg.entregaAt?.toISOString().slice(0, 10)).toBe('2026-08-27');
    }
  });
});

describe('TEST 5 — la fecha de ejecución (hoy) nunca sustituye a la fecha de negocio elegida', () => {
  test('Aunque el test corra "hoy", el paquete queda fechado en la fecha operativa histórica', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const fechaHistorica = '2020-01-15'; // deliberadamente muy lejos de "hoy" para que la prueba nunca coincida por casualidad
    expect(fechaHistorica).not.toBe(hoy);

    await importar(['HIST-1'], { opcionesFecha: { modo: 'unica', fechaUnica: fechaHistorica }, tipo: 'CREAR_Y_ENTREGAR' });

    const pkg = await prisma.package.findUniqueOrThrow({ where: { code: 'HIST-1' } });
    expect(pkg.entregaAt?.toISOString().slice(0, 10)).toBe(fechaHistorica);
    expect(pkg.ingresoAt.toISOString().slice(0, 10)).toBe(fechaHistorica);
  });
});

describe('TEST 4 — el movimiento financiero (Pago) respeta la fecha operativa', () => {
  test('Pago.createdAt queda en la fecha operativa, no en la fecha real de ejecución', async () => {
    const { resultado } = await importar(['FINA-1'], { opcionesFecha: { modo: 'unica', fechaUnica: '2026-08-27' }, tipo: 'CREAR_Y_ENTREGAR' });
    expect(resultado.creados).toBe(1);

    const pkg = await prisma.package.findUniqueOrThrow({ where: { code: 'FINA-1' } });
    const pago = await prisma.pago.findFirstOrThrow({ where: { packageId: pkg.id } });
    expect(pago.monto).toBe(2); // tarifaBase por defecto
    expect(pago.createdAt.toISOString().slice(0, 10)).toBe('2026-08-27');
    expect(pago.importLogId).toBeTruthy();
  });
});

describe('TEST 2/9 — "usar fecha de cada fila" respeta la fecha propia de cada una', () => {
  test('Dos filas con fechas distintas terminan en fechas distintas, no en una fecha común', async () => {
    const filas: FilaImportacion[] = [
      { numeroFila: 2, codigo: 'ROWA-1', fechaRecepcion: '10/01/2026' },
      { numeroFila: 3, codigo: 'ROWA-2', fechaRecepcion: '20/02/2026' },
    ];
    const resumen = await validarFilas(filas, { modo: 'por_fila' }, 2);
    const importLogId = await crearImportLogInicial({ nombreArchivo: 'test.xlsx', formato: 'XLSX', resumen, tipo: 'CREAR_Y_ENTREGAR', userId });
    const resultado = await ejecutarImportacion(resumen, 'CREAR_Y_ENTREGAR', userId, branchId, 2, { importLogId });
    await finalizarImportLog({ importLogId, nombreArchivo: 'test.xlsx', resumen, resultado, userId });
    expect(resultado.creados).toBe(2);

    const p1 = await prisma.package.findUniqueOrThrow({ where: { code: 'ROWA-1' } });
    const p2 = await prisma.package.findUniqueOrThrow({ where: { code: 'ROWA-2' } });
    expect(p1.entregaAt?.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(p2.entregaAt?.toISOString().slice(0, 10)).toBe('2026-02-20');
  });
});

describe('TEST 6 — reimportar el mismo archivo no duplica nada (idempotencia)', () => {
  test('La segunda corrida detecta los paquetes ya existentes y no crea ni cobra de nuevo', async () => {
    const codigos = ['IDMA-1', 'IDMA-2'];
    const opcionesFecha: OpcionesFechaRecepcion = { modo: 'unica', fechaUnica: '2026-05-01' };

    const primera = await importar(codigos, { opcionesFecha, tipo: 'CREAR_Y_ENTREGAR' });
    expect(primera.resultado.creados).toBe(2);

    const segunda = await importar(codigos, { opcionesFecha, tipo: 'CREAR_Y_ENTREGAR' });
    expect(segunda.resultado.creados).toBe(0); // ya existen -> "ya_entregado", CREAR_Y_ENTREGAR no vuelve a crearlos
    expect(segunda.resumen.filas.every((f) => f.estado === 'ya_entregado')).toBe(true);

    const paquetes = await prisma.package.findMany({ where: { code: { in: codigos } } });
    expect(paquetes).toHaveLength(2); // no se duplicó ningún Package

    for (const pkg of paquetes) {
      const pagos = await prisma.pago.findMany({ where: { packageId: pkg.id } });
      expect(pagos).toHaveLength(1); // no se duplicó ningún cobro
    }
  });
});

describe('TEST 7 — progreso real conectado al procesamiento (varios bloques)', () => {
  test('onProgreso se dispara exactamente una vez por fila procesada, cruzando el límite de un bloque', async () => {
    const N = 450; // > TAMANO_BLOQUE (200): fuerza al menos 3 bloques físicos
    const codigos = Array.from({ length: N }, (_, i) => `PRGA-${i + 1}`);

    let llamadas = 0;
    const numerosVistos = new Set<number>();
    const onProgreso: OnProgreso = (info) => {
      llamadas++;
      numerosVistos.add(info.numeroFila);
    };

    const { resultado } = await importar(codigos, { opcionesFecha: { modo: 'unica', fechaUnica: '2026-03-03' }, tipo: 'CREAR_Y_ENTREGAR', onProgreso });

    expect(resultado.creados).toBe(N);
    expect(resultado.conError).toBe(0);
    expect(llamadas).toBe(N); // el contador está atado al procesamiento real, no es un número "de mentira"
    expect(numerosVistos.size).toBe(N);
  }, 30_000);
});

describe('TEST 8 — una fila con error no rompe el resto del bloque', () => {
  test('Un conflicto real en la base de datos (código ya creado por otra vía) solo afecta a esa fila', async () => {
    const codigos = ['ERRA-1', 'ERRA-2', 'ERRA-3', 'ERRA-4', 'ERRA-5'];
    const filas = filasDesde(codigos);
    const resumen = await validarFilas(filas, undefined, 2);
    expect(resumen.filas.every((f) => f.estado === 'no_encontrado')).toBe(true);

    // Simula una condición de carrera real: entre la previsualización y la
    // confirmación, otra vía (ej. Recepción) ya registró ERRA-3 — el
    // UNIQUE constraint de codigoNormalizado hace que package.create()
    // falle SOLO para esa fila dentro de su propio SAVEPOINT.
    await prisma.packageSeries.create({ data: { inicial: 'ERRA', descripcion: 'Serie de prueba' } });
    await prisma.package.create({
      data: { code: 'ERRA-3', codigoNormalizado: 'ERRA3', inicial: 'ERRA', branchId, status: 'EN_PAQUETERIA' },
    });

    const r = await crearPaquetesFaltantes(resumen.filas, userId, branchId, 2);
    expect(r.creados).toBe(4);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]!.fila).toBe(4); // ERRA-3 es la 3ra fila -> numeroFila 4 (offset +2)

    const creadosPorImport = await prisma.package.findMany({ where: { code: { in: ['ERRA-1', 'ERRA-2', 'ERRA-4', 'ERRA-5'] } } });
    expect(creadosPorImport).toHaveLength(4);
    expect(creadosPorImport.every((p) => p.status === 'ENTREGADO')).toBe(true);
  });
});

describe('TEST 9 — revertir una importación deshace exactamente lo que generó', () => {
  test('Revertir "Crear y entregar" elimina los paquetes creados y sus pagos, sin tocar nada más', async () => {
    const codigos = ['REVA-1', 'REVA-2', 'REVA-3'];
    const { importLogId } = await importar(codigos, { opcionesFecha: { modo: 'unica', fechaUnica: '2026-06-06' }, tipo: 'CREAR_Y_ENTREGAR' });

    const antes = await prisma.package.findMany({ where: { code: { in: codigos } } });
    expect(antes).toHaveLength(3);

    const resultado = await revertirLoteImportacion(importLogId, userId);
    expect(resultado.paquetesEliminados).toBe(3);
    expect(resultado.pagosRevertidos).toBe(0); // el Pago se eliminó junto con el paquete (cascada), no via revertir un cobro
    expect(resultado.noReversibles).toHaveLength(0);

    const despues = await prisma.package.findMany({ where: { code: { in: codigos } } });
    expect(despues).toHaveLength(0);

    const log = await prisma.importLog.findUniqueOrThrow({ where: { id: importLogId } });
    expect(log.revertidoAt).not.toBeNull();

    await expect(revertirLoteImportacion(importLogId, userId)).rejects.toThrow(LoteYaRevertidoError);
  });

  test('Revertir "Marcar entregados" repone el estado y el cobro anteriores de un paquete preexistente', async () => {
    await prisma.packageSeries.create({ data: { inicial: 'REVB', descripcion: 'Serie de prueba' } });
    const pkg = await prisma.package.create({
      data: { code: 'REVB-1', codigoNormalizado: 'REVB1', inicial: 'REVB', branchId, status: 'EN_PAQUETERIA', ingresoAt: new Date('2026-01-01T00:00:00') },
    });
    // Recepción real siempre deja una fila de historial al crear el
    // paquete — sin ella no hay ningún estado "anterior" documentado al
    // que la reversión pueda volver con seguridad (ver planificarReversion:
    // nunca inventa un estado anterior que no puede probar).
    await prisma.packageHistory.create({ data: { packageId: pkg.id, estado: 'EN_PAQUETERIA', fecha: pkg.ingresoAt, userId, nota: 'Recepción' } });

    const { importLogId } = await importar(['REVB-1'], {
      opcionesFecha: { modo: 'unica', fechaUnica: '2026-01-05' },
      tipo: 'MARCAR_ENTREGADOS',
      extra: { monto: 2 },
    });

    const entregado = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(entregado.status).toBe('ENTREGADO');
    expect(entregado.montoPagado).toBe(2);

    const resultado = await revertirLoteImportacion(importLogId, userId);
    expect(resultado.entregasRevertidas).toBe(1);
    expect(resultado.pagosRevertidos).toBe(1);

    const revertido = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(revertido.status).toBe('EN_PAQUETERIA');
    expect(revertido.entregaAt).toBeNull();
    expect(revertido.montoPagado).toBe(0);

    const pagos = await prisma.pago.findMany({ where: { packageId: pkg.id } });
    expect(pagos).toHaveLength(0);
  });

  test('Un paquete modificado después de la importación queda marcado como no reversible (nunca se fuerza)', async () => {
    await prisma.packageSeries.create({ data: { inicial: 'REVC', descripcion: 'Serie de prueba' } });
    const pkg = await prisma.package.create({
      data: { code: 'REVC-1', codigoNormalizado: 'REVC1', inicial: 'REVC', branchId, status: 'EN_PAQUETERIA', ingresoAt: new Date('2026-01-01T00:00:00') },
    });
    const { importLogId } = await importar(['REVC-1'], { opcionesFecha: { modo: 'unica', fechaUnica: '2026-01-05' }, tipo: 'MARCAR_ENTREGADOS', extra: { monto: 2 } });

    // Algo externo a la importación toca el paquete después (ej. un
    // reingreso manual por un administrador).
    await prisma.package.update({ where: { id: pkg.id }, data: { observaciones: 'Tocado después, fuera de la importación' } });
    await prisma.packageHistory.create({ data: { packageId: pkg.id, estado: 'ENTREGADO', fecha: new Date(), userId, nota: 'Evento ajeno a la importación' } });

    const resultado = await revertirLoteImportacion(importLogId, userId);
    expect(resultado.entregasRevertidas).toBe(0);
    expect(resultado.noReversibles).toHaveLength(1);
    expect(resultado.noReversibles[0]!.codigo).toBe('REVC-1');

    // El paquete queda exactamente como estaba — la reversión nunca lo tocó.
    const intacto = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(intacto.status).toBe('ENTREGADO');
  });
});
