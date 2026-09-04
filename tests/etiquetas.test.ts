// tests/etiquetas.test.ts
// Pruebas de integración (contra SQLite real, ver tests/setup.ts) para el
// módulo de Etiquetas auditado: formato del código sin cero a la
// izquierda, numeración por DÍA + SERIE (nunca acumulada entre días),
// múltiples series en un mismo trabajo, generación semanal, y eliminación
// segura de un lote.
import { describe, test, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  construirCodigo,
  calcularFechasLote,
  generarLote,
  parseConsecutivo,
  obtenerUltimoConsecutivoDelDia,
  eliminarLoteEtiquetas,
  getLotesEtiquetasEliminables,
  LoteEtiquetasConCodigosUsadosError,
} from '@/lib/etiquetas';

let userId: string;

const LETRAS_MES: Array<{ mes: number; letra: string }> = [
  { mes: 1, letra: 'E' },
  { mes: 2, letra: 'F' },
  { mes: 3, letra: 'M' },
  { mes: 4, letra: 'A' },
  { mes: 5, letra: 'Y' },
  { mes: 6, letra: 'J' },
  { mes: 7, letra: 'L' },
  { mes: 8, letra: 'G' },
  { mes: 9, letra: 'S' },
  { mes: 10, letra: 'O' },
  { mes: 11, letra: 'N' },
  { mes: 12, letra: 'D' },
];

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba' } });
  const user = await prisma.user.create({
    data: { username: 'admin-etiquetas-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  await prisma.$transaction(LETRAS_MES.map((l) => prisma.monthLetter.upsert({ where: { mes: l.mes }, update: { letra: l.letra }, create: l })));
});

describe('TEST 1/2/3 — construirCodigo() nunca usa cero a la izquierda en el día', () => {
  test('día 3: M3T-1 .. M3T-210, nunca M03T', () => {
    const c1 = construirCodigo('M', '2026-09-03', 'S', '-', 1);
    const c11 = construirCodigo('M', '2026-09-03', 'S', '-', 11);
    const c210 = construirCodigo('M', '2026-09-03', 'S', '-', 210);
    expect(c1).toBe('M3S-1');
    expect(c11).toBe('M3S-11');
    expect(c210).toBe('M3S-210');
    expect(c1).not.toContain('M03');
    expect(c11).not.toContain('M03');
  });

  test('día 1: M1T-1', () => {
    expect(construirCodigo('M', '2026-09-01', 'S', '-', 1)).toBe('M1S-1');
  });

  test('día 9: M9T-1', () => {
    expect(construirCodigo('M', '2026-09-09', 'S', '-', 1)).toBe('M9S-1');
  });

  test('día 10: M10T-1 (dos dígitos reales, no cero de formato)', () => {
    expect(construirCodigo('M', '2026-09-10', 'S', '-', 1)).toBe('M10S-1');
  });

  test('día 30: M30T-1', () => {
    expect(construirCodigo('M', '2026-09-30', 'S', '-', 1)).toBe('M30S-1');
  });
});

describe('TEST 4/5/6 — numeración por DÍA + SERIE en generarLote()', () => {
  test('un solo día: consecutivos exactos 1..210, sin huecos', async () => {
    const fechas = calcularFechasLote({ modo: 'especifica', fecha: '2026-09-03' });
    const r = await generarLote({ inicial: 'DIAA', fechas, cantidadPorDia: 210, consecutivoInicial: 1, separador: '-', userId });
    expect(r.codigos).toHaveLength(210);
    expect(r.primerConsecutivo).toBe(1);
    expect(r.ultimoConsecutivo).toBe(210);
    expect(r.codigos[0]!.code).toBe('DIAA3S-1');
    expect(r.codigos[209]!.code).toBe('DIAA3S-210');
    const consecutivos = r.codigos.map((c) => parseConsecutivo(c.code)!.consecutivo).sort((a, b) => a - b);
    expect(consecutivos).toEqual(Array.from({ length: 210 }, (_, i) => i + 1));
  });

  test('semana completa: cada día reinicia en 1, el día 2 NUNCA empieza en 211', async () => {
    const fechas = calcularFechasLote({ modo: 'rango', fechaInicio: '2026-09-03', fechaFin: '2026-09-07' }); // 5 días
    expect(fechas).toHaveLength(5);

    const r = await generarLote({ inicial: 'SEMB', fechas, cantidadPorDia: 210, consecutivoInicial: 1, separador: '-', userId });
    expect(r.codigos).toHaveLength(5 * 210); // 1050 en total, pero NUNCA como un rango continuo 1..1050

    // Agrupa por fecha y verifica que CADA día tenga exactamente 1..210 —
    // nunca 211..420 en el segundo día (bug real confirmado en auditoría).
    const porFecha = new Map<string, number[]>();
    for (const c of r.codigos) {
      const consecutivo = parseConsecutivo(c.code)!.consecutivo;
      porFecha.set(c.fecha, [...(porFecha.get(c.fecha) ?? []), consecutivo]);
    }
    expect(porFecha.size).toBe(5);
    for (const fecha of fechas) {
      const consecutivosDelDia = (porFecha.get(fecha) ?? []).sort((a, b) => a - b);
      expect(consecutivosDelDia).toEqual(Array.from({ length: 210 }, (_, i) => i + 1)); // siempre 1..210, en TODOS los días
    }

    // Verificación explícita del caso reportado: día 2 (04/09) no arranca en 211.
    const dia2 = (porFecha.get('2026-09-04') ?? []).sort((a, b) => a - b);
    expect(dia2[0]).toBe(1);
    expect(dia2[dia2.length - 1]).toBe(210);
  });

  test('el código real del día 4 usa el día correcto sin cero (M4...) y el consecutivo 1, no continúa el del día 3', async () => {
    const fechas = calcularFechasLote({ modo: 'rango', fechaInicio: '2026-09-03', fechaFin: '2026-09-05' });
    const r = await generarLote({ inicial: 'SEMC', fechas, cantidadPorDia: 210, consecutivoInicial: 1, separador: '-', userId });
    const primerCodigoDia4 = r.codigos.find((c) => c.fecha === '2026-09-04');
    expect(primerCodigoDia4).toBeDefined();
    // El primer código insertado para el día 4 debe ser consecutivo 1.
    const codigosDia4 = r.codigos.filter((c) => c.fecha === '2026-09-04').map((c) => parseConsecutivo(c.code)!.consecutivo);
    expect(Math.min(...codigosDia4)).toBe(1);
    expect(Math.max(...codigosDia4)).toBe(210);
  });
});

describe('TEST 7 — múltiples series (M + S) en un mismo trabajo semanal', () => {
  test('cada serie genera su propio 1..210 por día, sin mezclarse entre sí', async () => {
    const fechas = calcularFechasLote({ modo: 'rango', fechaInicio: '2026-09-03', fechaFin: '2026-09-04' }); // 2 días
    const rM = await generarLote({ inicial: 'MULM', fechas, cantidadPorDia: 210, consecutivoInicial: 1, separador: '-', userId });
    const rS = await generarLote({ inicial: 'MULS', fechas, cantidadPorDia: 210, consecutivoInicial: 1, separador: '-', userId });

    expect(rM.codigos).toHaveLength(420);
    expect(rS.codigos).toHaveLength(420);
    // Ningún código se pisa entre series (prefijos distintos garantizan unicidad real).
    const setM = new Set(rM.codigos.map((c) => c.code));
    const setS = new Set(rS.codigos.map((c) => c.code));
    expect([...setM].some((c) => setS.has(c))).toBe(false);
    expect(rM.codigos[0]!.code).toBe('MULM3S-1');
    expect(rS.codigos[0]!.code).toBe('MULS3S-1');
  });
});

describe('TEST — obtenerUltimoConsecutivoDelDia() (base de "Continuar lote")', () => {
  test('0 cuando el día no tiene códigos; el último real cuando sí', async () => {
    expect(await obtenerUltimoConsecutivoDelDia('CONT', '2026-09-03')).toBe(0);
    const fechas = calcularFechasLote({ modo: 'especifica', fecha: '2026-09-03' });
    await generarLote({ inicial: 'CONT', fechas, cantidadPorDia: 50, consecutivoInicial: 1, separador: '-', userId });
    expect(await obtenerUltimoConsecutivoDelDia('CONT', '2026-09-03')).toBe(50);
    // Un día distinto de la misma serie sigue en 0 — nunca hereda el del otro día.
    expect(await obtenerUltimoConsecutivoDelDia('CONT', '2026-09-04')).toBe(0);
  });
});

describe('TEST 9 — eliminación segura de un lote', () => {
  test('un lote sin códigos usados se elimina y desaparece del historial', async () => {
    const fechas = calcularFechasLote({ modo: 'especifica', fecha: '2026-09-03' });
    const r = await generarLote({ inicial: 'DELA', fechas, cantidadPorDia: 10, consecutivoInicial: 1, separador: '-', userId });

    const eliminables = await getLotesEtiquetasEliminables([r.batchId]);
    expect(eliminables.has(r.batchId)).toBe(true);

    await eliminarLoteEtiquetas(r.batchId, userId);

    const lote = await prisma.labelBatch.findUnique({ where: { id: r.batchId } });
    expect(lote).toBeNull();
    const codigos = await prisma.generatedCode.findMany({ where: { code: { in: r.codigos.map((c) => c.code) } } });
    expect(codigos).toHaveLength(0);
  });

  test('un lote con al menos un código usado NO se puede eliminar (paquete real protegido)', async () => {
    const fechas = calcularFechasLote({ modo: 'especifica', fecha: '2026-09-03' });
    const r = await generarLote({ inicial: 'DELB', fechas, cantidadPorDia: 5, consecutivoInicial: 1, separador: '-', userId });

    // Simula que Recepción escaneó una de estas etiquetas (mismo efecto
    // que produce src/app/api/recepcion/scan/route.ts).
    await prisma.generatedCode.update({ where: { code: r.codigos[0]!.code }, data: { usado: true } });

    const eliminables = await getLotesEtiquetasEliminables([r.batchId]);
    expect(eliminables.has(r.batchId)).toBe(false);

    await expect(eliminarLoteEtiquetas(r.batchId, userId)).rejects.toThrow(LoteEtiquetasConCodigosUsadosError);

    // Nada se borró: el lote y todos sus códigos siguen intactos.
    const lote = await prisma.labelBatch.findUnique({ where: { id: r.batchId } });
    expect(lote).not.toBeNull();
    const codigos = await prisma.generatedCode.findMany({ where: { code: { in: r.codigos.map((c) => c.code) } } });
    expect(codigos).toHaveLength(5);
  });
});

describe('TEST — Hoy/Mañana/Fecha específica/Rango siguen funcionando (misma función central)', () => {
  test('cada modo produce exactamente la cantidad de días esperada', () => {
    expect(calcularFechasLote({ modo: 'hoy' })).toHaveLength(1);
    expect(calcularFechasLote({ modo: 'manana' })).toHaveLength(1);
    expect(calcularFechasLote({ modo: 'especifica', fecha: '2026-09-03' })).toEqual(['2026-09-03']);
    expect(calcularFechasLote({ modo: 'rango', fechaInicio: '2026-09-01', fechaFin: '2026-09-10' })).toHaveLength(10);
  });
});
