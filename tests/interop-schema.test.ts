// tests/interop-schema.test.ts
// Fase 4.1 (preparación de esquema para comunicación segura entre
// instalaciones — La Paz / El Alto / futuras): esta fase NO agrega
// endpoints /api/interop, NO agrega HMAC, NO agrega llamadas HTTP, y NO
// cambia el comportamiento de Envíos/Recepción. Lo único que existe para
// probar en esta fase es el propio ESQUEMA (columnas nuevas, todas
// opcionales, y las restricciones de la base de datos que van a sostener
// la idempotencia cuando la Fase 4.2 implemente los endpoints reales).
// Contra SQLite real de prueba (ver tests/setup.ts) — nunca contra
// prisma/dev.db. Ningún test de HTTP aquí (ver instrucción explícita de
// esta fase).
import { describe, test, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

let branchId: string;

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba interop-schema' } });
  branchId = branch.id;
  await prisma.packageSeries.upsert({ where: { inicial: 'Z' }, update: {}, create: { inicial: 'Z', descripcion: 'Prueba interop' } });
});

describe('Fase 4.1 — SucursalDestino: credenciales de comunicación (todas opcionales)', () => {
  test('un destino sin ninguna credencial configurada se crea exactamente igual que antes (compatibilidad hacia atrás)', async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: 'Z1', nombre: 'Destino sin credenciales' } });
    expect(destino.apiUrlSaliente).toBeNull();
    expect(destino.apiKeySaliente).toBeNull();
    expect(destino.apiKeyEntrante).toBeNull();
  });

  test('un destino puede guardar las tres credenciales de comunicación', async () => {
    const destino = await prisma.sucursalDestino.create({
      data: {
        codigo: 'Z2',
        nombre: 'Destino con credenciales',
        apiUrlSaliente: 'https://elalto.cofreexpress.example/api/interop',
        apiKeySaliente: 'secreto-saliente-de-prueba',
        apiKeyEntrante: 'secreto-entrante-de-prueba',
      },
    });
    expect(destino.apiUrlSaliente).toBe('https://elalto.cofreexpress.example/api/interop');
    expect(destino.apiKeySaliente).toBe('secreto-saliente-de-prueba');
    expect(destino.apiKeyEntrante).toBe('secreto-entrante-de-prueba');
  });
});

describe('Fase 4.1 — Envio.transferenciaId: identidad técnica separada de código y de qrToken', () => {
  let destinoId: string;
  beforeAll(async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: 'Z3', nombre: 'Destino para transferenciaId' } });
    destinoId = destino.id;
  });

  test('se genera automáticamente al crear un envío, sin que nadie lo pida explícitamente', async () => {
    const envio = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-001', destinoId } });
    expect(envio.transferenciaId).toBeTruthy();
    expect(envio.transferenciaId).not.toBe(envio.codigo);
    expect(envio.transferenciaId).not.toBe(envio.qrToken); // qrToken sigue null hasta el cierre
  });

  test('dos envíos distintos nunca comparten el mismo transferenciaId', async () => {
    const a = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-002', destinoId } });
    const b = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-003', destinoId } });
    expect(a.transferenciaId).not.toBe(b.transferenciaId);
  });

  test('un envío "legado" con transferenciaId explícitamente null convive con otros (múltiples NULL, igual que diaAperturaKey)', async () => {
    const a = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-LEGADO-001', destinoId, transferenciaId: null } });
    const b = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-LEGADO-002', destinoId, transferenciaId: null } });
    expect(a.transferenciaId).toBeNull();
    expect(b.transferenciaId).toBeNull();
  });

  test('intentar reutilizar un transferenciaId ya existente en otro envío es rechazado (unicidad real, no solo por convención)', async () => {
    const original = await prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-004', destinoId } });
    await expect(
      prisma.envio.create({ data: { codigo: 'ENV-TEST-TID-005', destinoId, transferenciaId: original.transferenciaId } })
    ).rejects.toThrow();
  });
});

describe('Fase 4.1 — Package: identidad de un paquete transferido (sucursalOrigen + codigoPaquete, nunca "code" solo)', () => {
  test('un paquete registrado normalmente (Recepción/Envíos locales) no tiene ningún dato de origen — comportamiento actual intacto', async () => {
    const pkg = await prisma.package.create({
      data: { code: 'Z1T-1', codigoNormalizado: 'Z1T1', inicial: 'Z', branchId, status: 'EN_PAQUETERIA' },
    });
    expect(pkg.origenSucursalCodigo).toBeNull();
    expect(pkg.origenCodigoPaquete).toBeNull();
    expect(pkg.origenTransferenciaId).toBeNull();
  });

  test('muchos paquetes locales (todos con origen null) conviven sin chocar contra el índice único compuesto', async () => {
    const a = await prisma.package.create({ data: { code: 'Z1T-2', codigoNormalizado: 'Z1T2', inicial: 'Z', branchId, status: 'EN_PAQUETERIA' } });
    const b = await prisma.package.create({ data: { code: 'Z1T-3', codigoNormalizado: 'Z1T3', inicial: 'Z', branchId, status: 'EN_PAQUETERIA' } });
    expect(a.origenSucursalCodigo).toBeNull();
    expect(b.origenSucursalCodigo).toBeNull();
  });

  test('un paquete materializado por transferencia guarda sucursalOrigen + codigoPaquete + transferencia de origen', async () => {
    const pkg = await prisma.package.create({
      data: {
        code: 'Z1T-4',
        codigoNormalizado: 'Z1T4',
        inicial: 'Z',
        branchId,
        status: 'EN_PAQUETERIA',
        origenSucursalCodigo: 'LPZ',
        origenCodigoPaquete: 'M24J-125',
        origenTransferenciaId: 'transferencia-de-prueba-001',
      },
    });
    expect(pkg.origenSucursalCodigo).toBe('LPZ');
    expect(pkg.origenCodigoPaquete).toBe('M24J-125');
    expect(pkg.origenTransferenciaId).toBe('transferencia-de-prueba-001');
  });

  test('el MISMO paquete de origen (misma sucursalOrigen + mismo codigoPaquete) no puede materializarse dos veces aquí — previene duplicados a nivel de Package', async () => {
    await prisma.package.create({
      data: { code: 'Z1T-5', codigoNormalizado: 'Z1T5', inicial: 'Z', branchId, status: 'EN_PAQUETERIA', origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-200' },
    });
    await expect(
      prisma.package.create({
        data: { code: 'Z1T-6', codigoNormalizado: 'Z1T6', inicial: 'Z', branchId, status: 'EN_PAQUETERIA', origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-200' },
      })
    ).rejects.toThrow();
  });

  test('el mismo codigoPaquete es aceptable si la sucursalOrigen es distinta (el par completo es lo que identifica, nunca un solo campo)', async () => {
    await prisma.package.create({
      data: { code: 'Z1T-7', codigoNormalizado: 'Z1T7', inicial: 'Z', branchId, status: 'EN_PAQUETERIA', origenSucursalCodigo: 'LPZ', origenCodigoPaquete: 'M24J-300' },
    });
    const otraSucursal = await prisma.package.create({
      data: { code: 'Z1T-8', codigoNormalizado: 'Z1T8', inicial: 'Z', branchId, status: 'EN_PAQUETERIA', origenSucursalCodigo: 'ORU', origenCodigoPaquete: 'M24J-300' },
    });
    expect(otraSucursal.origenCodigoPaquete).toBe('M24J-300');
  });
});

describe('Fase 4.1 — EnvioRecepcionRemota: idempotencia de la recepción remota', () => {
  test('registrar la recepción de una transferencia funciona la primera vez', async () => {
    const registro = await prisma.envioRecepcionRemota.create({
      data: { transferenciaId: 'transferencia-idem-001', origenCodigo: 'LPZ', envioCodigoOrigen: 'ENV-20260904-001', cantidadPaquetes: 3 },
    });
    expect(registro.transferenciaId).toBe('transferencia-idem-001');
    expect(registro.cantidadPaquetes).toBe(3);
  });

  test('repetir la MISMA transferenciaId es rechazado por la base de datos — la garantía real de idempotencia, no solo una convención de código', async () => {
    await prisma.envioRecepcionRemota.create({
      data: { transferenciaId: 'transferencia-idem-002', origenCodigo: 'LPZ', envioCodigoOrigen: 'ENV-20260904-002', cantidadPaquetes: 1 },
    });

    await expect(
      prisma.envioRecepcionRemota.create({
        data: { transferenciaId: 'transferencia-idem-002', origenCodigo: 'LPZ', envioCodigoOrigen: 'ENV-20260904-002', cantidadPaquetes: 1 },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('el error de duplicado es específicamente una violación de restricción única de Prisma (P2002), identificable por un futuro endpoint para responder "ya fue recibido" en vez de un error genérico', async () => {
    await prisma.envioRecepcionRemota.create({
      data: { transferenciaId: 'transferencia-idem-003', origenCodigo: 'ELA', envioCodigoOrigen: 'ENV-20260905-001', cantidadPaquetes: 2 },
    });

    try {
      await prisma.envioRecepcionRemota.create({
        data: { transferenciaId: 'transferencia-idem-003', origenCodigo: 'ELA', envioCodigoOrigen: 'ENV-20260905-001', cantidadPaquetes: 2 },
      });
      expect.unreachable('debía lanzar por violar el índice único de transferenciaId');
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    }
  });

  test('transferencias distintas nunca chocan entre sí', async () => {
    const a = await prisma.envioRecepcionRemota.create({
      data: { transferenciaId: 'transferencia-idem-004', origenCodigo: 'LPZ', envioCodigoOrigen: 'ENV-20260906-001' },
    });
    const b = await prisma.envioRecepcionRemota.create({
      data: { transferenciaId: 'transferencia-idem-005', origenCodigo: 'LPZ', envioCodigoOrigen: 'ENV-20260906-002' },
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('Fase 4.4 — Envio.recibidoViaInterop: distingue recepción local de recepción remota', () => {
  let destinoId: string;
  beforeAll(async () => {
    const destino = await prisma.sucursalDestino.create({ data: { codigo: 'Z4', nombre: 'Destino para recibidoViaInterop' } });
    destinoId = destino.id;
  });

  test('j) un envío nuevo (y, por extensión, cualquier fila existente antes de esta columna) queda con recibidoViaInterop=false por defecto, sin que nadie lo pida explícitamente', async () => {
    const envio = await prisma.envio.create({ data: { codigo: 'ENV-TEST-RVI-001', destinoId } });
    expect(envio.recibidoViaInterop).toBe(false);
  });

  test('puede fijarse explícitamente en true (lo que hace recibirEnvio({viaInterop:true}) — ver interop-recibir.test.ts para el flujo completo)', async () => {
    const envio = await prisma.envio.create({ data: { codigo: 'ENV-TEST-RVI-002', destinoId, estado: 'RECIBIDO', recibidoViaInterop: true } });
    expect(envio.recibidoViaInterop).toBe(true);
  });
});
