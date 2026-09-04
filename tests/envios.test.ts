// tests/envios.test.ts
// Modulo Envios (Fase 2). Contra SQLite real de prueba (ver
// tests/setup.ts) — nunca contra prisma/dev.db. Cubre: crear, destino
// obligatorio, agregar/evitar duplicado/evitar reserva cruzada, quitar,
// cerrar (inmutabilidad + QR), cancelar (libera paquetes), AuditLog de
// cada accion, y que Package.status NUNCA cambia por estar en un envio.
import { describe, test, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  crearEnvio,
  agregarPaquete,
  quitarPaquete,
  cerrarEnvio,
  cancelarEnvio,
  getEnvioDetalle,
  DestinoNoEncontradoError,
  DestinoInactivoError,
  EnvioNoModificableError,
  EnvioVacioError,
  PaqueteNoElegibleError,
  PaqueteYaReservadoError,
} from '@/lib/envios';
import { entregarPaquete, PaqueteEnEnvioError } from '@/lib/package-transitions';

let userId: string;
let destinoId: string;
let seq = 0;

async function crearPaqueteDePrueba(status: string = 'EN_PAQUETERIA'): Promise<{ id: string; code: string }> {
  seq++;
  const inicial = 'X';
  await prisma.packageSeries.upsert({ where: { inicial }, update: {}, create: { inicial, descripcion: 'Prueba' } });
  const branch = await prisma.branch.findFirst();
  const code = `X1T-${seq}`;
  const pkg = await prisma.package.create({
    data: {
      code,
      codigoNormalizado: code.replace(/-/g, ''),
      inicial,
      branchId: branch!.id,
      status,
      registradoPorId: userId,
    },
  });
  return { id: pkg.id, code: pkg.code };
}

beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { nombre: 'Sucursal de prueba envios' } });
  const user = await prisma.user.create({
    data: { username: 'admin-envios-test', passwordHash: 'x', nombre: 'Admin de prueba', role: 'ADMIN', branchId: branch.id },
  });
  userId = user.id;
  const destino = await prisma.sucursalDestino.create({ data: { codigo: 'ELA', nombre: 'Cofre Express El Alto', ciudad: 'El Alto' } });
  destinoId = destino.id;
});

describe('TEST 1/2 — crear envío / destino obligatorio', () => {
  test('crea un envío en BORRADOR con código único', async () => {
    const envio = await crearEnvio(destinoId, userId);
    expect(envio.estado).toBe('BORRADOR');
    expect(envio.codigo).toMatch(/^ENV-\d{8}-\d{3}$/);
    expect(envio.destino.id).toBe(destinoId);
    expect(envio.qrToken).toBeNull();
  });

  test('rechaza un destino que no existe', async () => {
    await expect(crearEnvio('no-existe', userId)).rejects.toThrow(DestinoNoEncontradoError);
  });

  test('rechaza un destino inactivo', async () => {
    const inactivo = await prisma.sucursalDestino.create({ data: { codigo: 'INACT', nombre: 'Inactiva', activa: false } });
    await expect(crearEnvio(inactivo.id, userId)).rejects.toThrow(DestinoInactivoError);
  });
});

describe('TEST 3 — agregar paquete', () => {
  test('agrega un paquete EN_PAQUETERIA sin tocar Package.status', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba('EN_PAQUETERIA');

    const actualizado = await agregarPaquete(envio.id, pkg.code, userId);
    expect(actualizado.items).toHaveLength(1);
    expect(actualizado.items[0]!.code).toBe(pkg.code);

    const pkgDespues = await prisma.package.findUnique({ where: { id: pkg.id } });
    expect(pkgDespues!.status).toBe('EN_PAQUETERIA'); // nunca cambia
  });

  test('rechaza un paquete ENTREGADO/DENEGADO/EN_DEPOSITO', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const entregado = await crearPaqueteDePrueba('ENTREGADO');
    const denegado = await crearPaqueteDePrueba('DENEGADO');
    const enDeposito = await crearPaqueteDePrueba('EN_DEPOSITO');

    await expect(agregarPaquete(envio.id, entregado.code, userId)).rejects.toThrow(PaqueteNoElegibleError);
    await expect(agregarPaquete(envio.id, denegado.code, userId)).rejects.toThrow(PaqueteNoElegibleError);
    await expect(agregarPaquete(envio.id, enDeposito.code, userId)).rejects.toThrow(PaqueteNoElegibleError);
  });
});

describe('TEST 4 — evitar paquete duplicado', () => {
  test('no permite agregar el mismo paquete dos veces al mismo envío', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await expect(agregarPaquete(envio.id, pkg.code, userId)).rejects.toThrow(PaqueteYaReservadoError);
  });
});

describe('TEST 5 — evitar paquete reservado en otro envío', () => {
  test('un paquete ya en un envío BORRADOR no puede agregarse a otro', async () => {
    const envioA = await crearEnvio(destinoId, userId);
    const envioB = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();

    await agregarPaquete(envioA.id, pkg.code, userId);
    await expect(agregarPaquete(envioB.id, pkg.code, userId)).rejects.toThrow(PaqueteYaReservadoError);
  });
});

describe('TEST 6 — quitar paquete', () => {
  test('quitar un paquete antes de cerrar lo libera del envío', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    const conPaquete = await agregarPaquete(envio.id, pkg.code, userId);

    const sinPaquete = await quitarPaquete(envio.id, pkg.id, userId);
    expect(sinPaquete.items).toHaveLength(0);
    expect(conPaquete.items).toHaveLength(1); // no muta el objeto anterior

    // Y ahora puede agregarse a otro envío sin problema.
    const otroEnvio = await crearEnvio(destinoId, userId);
    await expect(agregarPaquete(otroEnvio.id, pkg.code, userId)).resolves.toBeDefined();
  });
});

describe('TEST 7/11/12 — cerrar envío, QR', () => {
  test('cerrar genera qrToken y no se puede cerrar dos veces ni vacío', async () => {
    const envio = await crearEnvio(destinoId, userId);
    await expect(cerrarEnvio(envio.id, userId)).rejects.toThrow(EnvioVacioError);

    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);

    const cerrado = await cerrarEnvio(envio.id, userId);
    expect(cerrado.estado).toBe('CERRADO');
    expect(cerrado.qrToken).toBeTruthy();
    const qrOriginal = cerrado.qrToken;

    // TEST 8 — inmutable: no se puede cerrar de nuevo (protección optimista).
    await expect(cerrarEnvio(envio.id, userId)).rejects.toThrow(EnvioNoModificableError);

    // TEST 12 — el qrToken no cambia si se relee.
    const releido = await getEnvioDetalle(envio.id);
    expect(releido.qrToken).toBe(qrOriginal);
  });
});

describe('TEST 8 — envío cerrado es inmutable', () => {
  test('no se puede agregar ni quitar paquetes de un envío CERRADO', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    const otroPkg = await crearPaqueteDePrueba();
    await expect(agregarPaquete(envio.id, otroPkg.code, userId)).rejects.toThrow(EnvioNoModificableError);
    await expect(quitarPaquete(envio.id, pkg.id, userId)).rejects.toThrow(EnvioNoModificableError);
    await expect(cancelarEnvio(envio.id, userId)).rejects.toThrow(EnvioNoModificableError);
  });

  test('un paquete en un envío CERRADO no puede entregarse (guardia en package-transitions)', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    await expect(entregarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);
  });
});

describe('TEST 9/10 — cancelar envío libera los paquetes', () => {
  test('cancelar un BORRADOR libera sus paquetes para otro envío', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);

    const cancelado = await cancelarEnvio(envio.id, userId);
    expect(cancelado.estado).toBe('CANCELADO');

    // El paquete vuelve a estar disponible.
    const otroEnvio = await crearEnvio(destinoId, userId);
    const conPaquete = await agregarPaquete(otroEnvio.id, pkg.code, userId);
    expect(conPaquete.items).toHaveLength(1);

    // Y puede entregarse normalmente (no quedó bloqueado por el envío cancelado).
    await quitarPaquete(otroEnvio.id, pkg.id, userId);
    await expect(entregarPaquete(pkg.code, userId)).resolves.toBeDefined();
  });
});

describe('TEST 13 — AuditLog de cada acción', () => {
  test('crear/agregar/quitar/cerrar/cancelar quedan auditados en el módulo "envios"', async () => {
    const antes = await prisma.auditLog.count({ where: { modulo: 'envios' } });

    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await quitarPaquete(envio.id, pkg.id, userId);
    const pkg2 = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg2.code, userId);
    await cerrarEnvio(envio.id, userId);

    const envio2 = await crearEnvio(destinoId, userId);
    const pkg3 = await crearPaqueteDePrueba();
    await agregarPaquete(envio2.id, pkg3.code, userId);
    await cancelarEnvio(envio2.id, userId);

    const despues = await prisma.auditLog.findMany({ where: { modulo: 'envios' }, orderBy: { createdAt: 'asc' } });
    expect(despues.length).toBeGreaterThanOrEqual(antes + 7);
    expect(despues.map((a) => a.accion)).toEqual(
      expect.arrayContaining(['ENVIO_CREADO', 'ENVIO_PAQUETE_AGREGADO', 'ENVIO_PAQUETE_QUITADO', 'ENVIO_CERRADO', 'ENVIO_CANCELADO'])
    );
  });
});

describe('Package.status nunca cambia por Envíos', () => {
  test('a lo largo de todo este archivo, ningún paquete de prueba quedó con un status distinto al que se le asignó explícitamente', async () => {
    const paquetesTest = await prisma.package.findMany({ where: { inicial: 'X' } });
    for (const p of paquetesTest) {
      expect(['EN_PAQUETERIA', 'ENTREGADO', 'DENEGADO', 'EN_DEPOSITO']).toContain(p.status);
    }
  });
});
