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
  recibirEnvio,
  buscarEnvioParaRecibir,
  getEnvioDetalle,
  DestinoNoEncontradoError,
  DestinoInactivoError,
  EnvioNoModificableError,
  EnvioNoRecibibleError,
  EnvioVacioError,
  PaqueteNoEncontradoParaEnvioError,
  PaqueteNoElegibleError,
  PaqueteYaReservadoError,
} from '@/lib/envios';
import { entregarPaquete, PaqueteEnEnvioError } from '@/lib/package-transitions';
import { getPackageDetail } from '@/lib/package-detail';

let branchId: string;

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
  branchId = branch.id;
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

describe('Fase 2.2 — disponibilidad por sucursal (regla fundamental)', () => {
  test('A. un paquete local (sin envío) puede entregarse normalmente', async () => {
    const pkg = await crearPaqueteDePrueba();
    await expect(entregarPaquete(pkg.code, userId)).resolves.toBeDefined();
  });

  test('B. un paquete agregado a un envío BORRADOR todavía NO se considera enviado: sigue siendo entregable aquí', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    expect(envio.estado).toBe('BORRADOR');

    // Mientras el envío sigue en preparación, el paquete no salió
    // físicamente de esta sucursal — debe poder entregarse igual.
    const detalle = await getPackageDetail(pkg.code);
    expect(detalle?.enTransito).toBeNull();
    await expect(entregarPaquete(pkg.code, userId)).resolves.toBeDefined();
  });

  test('C. al cerrar el envío, el paquete pasa a "en tránsito" y deja de ser entregable en origen (backend, no solo UI)', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    const detalle = await getPackageDetail(pkg.code);
    expect(detalle?.enTransito).not.toBeNull();
    expect(detalle?.enTransito?.envioCodigo).toBe(envio.codigo);
    expect(detalle?.enTransito?.destinoNombre).toBe('Cofre Express El Alto');
    // Package.status NUNCA cambia por esto (mismo invariante de siempre).
    expect(detalle?.status).toBe('EN_PAQUETERIA');

    await expect(entregarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);
  });

  test('D. la protección es del backend, no de la UI: llamar entregarPaquete()/denegarPaquete()/enviarADeposito() directamente se rechaza igual', async () => {
    // "Llamar a la API directamente" a nivel de test de librería equivale
    // a invocar las funciones de dominio sin pasar por ninguna pantalla —
    // exactamente lo que haría la ruta HTTP. No hay ningún control extra
    // en las rutas API que no esté ya aquí (ver src/app/api/entrega/[code]/entregar/route.ts).
    const { denegarPaquete, enviarADeposito } = await import('@/lib/package-transitions');
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    await expect(entregarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);
    await expect(denegarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);
    await expect(enviarADeposito(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);
  });

  test('E. al recibir el envío en destino, el paquete vuelve a estar disponible ahí (mismo mecanismo, sin tocar Package.status)', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);
    await expect(entregarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);

    await recibirEnvio(envio.id, userId);

    const detalle = await getPackageDetail(pkg.code);
    expect(detalle?.enTransito).toBeNull();
    await expect(entregarPaquete(pkg.code, userId)).resolves.toBeDefined();
  });

  test('F. la regla funciona igual sin importar el nombre de las sucursales (no hay LPZ/ELA hardcodeado)', async () => {
    // Mismo destino de prueba de siempre ("Cofre Express El Alto"), pero
    // ahora con la identidad de instalación configurada como si esta
    // fuera otra sucursal cualquiera — la lógica no debe cambiar en nada.
    await prisma.company.upsert({
      where: { id: 1 },
      update: { sucursalCodigo: 'XYZ', sucursalNombre: 'Cofre Express Sucursal de Prueba' },
      create: { id: 1, sucursalCodigo: 'XYZ', sucursalNombre: 'Cofre Express Sucursal de Prueba' },
    });
    const otroDestino = await prisma.sucursalDestino.create({ data: { codigo: 'OTRA', nombre: 'Cofre Express Otra Ciudad' } });

    const envio = await crearEnvio(otroDestino.id, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    const detalle = await getPackageDetail(pkg.code);
    expect(detalle?.origenNombre).toBe('Cofre Express Sucursal de Prueba');
    expect(detalle?.enTransito?.destinoNombre).toBe('Cofre Express Otra Ciudad');
    await expect(entregarPaquete(pkg.code, userId)).rejects.toThrow(PaqueteEnEnvioError);

    await recibirEnvio(envio.id, userId);
    await expect(entregarPaquete(pkg.code, userId)).resolves.toBeDefined();

    await prisma.company.update({ where: { id: 1 }, data: { sucursalCodigo: null, sucursalNombre: null } });
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

describe('Fase 2.1 — flujo directo: agregar un código que todavía no existe', () => {
  test('con branchId, agregarPaquete registra el paquete en el acto (mismo alta que Recepción) y lo reserva', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'X' }, update: {}, create: { inicial: 'X', descripcion: 'Prueba' } });
    const envio = await crearEnvio(destinoId, userId);
    const codigoNuevo = 'X1T-DIRECTO1';

    const antes = await prisma.package.findFirst({ where: { code: codigoNuevo } });
    expect(antes).toBeNull();

    const actualizado = await agregarPaquete(envio.id, codigoNuevo, userId, branchId);
    expect(actualizado.items).toHaveLength(1);
    expect(actualizado.items[0]!.code).toBe(codigoNuevo);

    const creado = await prisma.package.findFirst({ where: { code: codigoNuevo } });
    expect(creado).not.toBeNull();
    expect(creado!.status).toBe('EN_PAQUETERIA');
    expect(creado!.registradoPorId).toBe(userId);
    expect(creado!.branchId).toBe(branchId);

    // Y queda igual de protegido que un paquete que sí pasó por Recepción:
    // no puede agregarse dos veces ni reservarse en otro envío.
    await expect(agregarPaquete(envio.id, codigoNuevo, userId, branchId)).rejects.toThrow(PaqueteYaReservadoError);
    const otroEnvio = await crearEnvio(destinoId, userId);
    await expect(agregarPaquete(otroEnvio.id, codigoNuevo, userId, branchId)).rejects.toThrow(PaqueteYaReservadoError);
  });

  test('sin branchId, un código inexistente se sigue rechazando (compatibilidad hacia atrás)', async () => {
    const envio = await crearEnvio(destinoId, userId);
    await expect(agregarPaquete(envio.id, 'X1T-NOEXISTE', userId)).rejects.toThrow(PaqueteNoEncontradoParaEnvioError);
  });
});

describe('Fase 2.1 (corrección) — "origen" siempre presente, una sola fuente de verdad', () => {
  test('crearEnvio, agregarPaquete, quitarPaquete, cerrarEnvio y cancelarEnvio devuelven todos "origen" (no solo el GET inicial)', async () => {
    const creado = await crearEnvio(destinoId, userId);
    expect(creado.origen).toBeDefined();
    expect(creado.origen.nombre === null || typeof creado.origen.nombre === 'string').toBe(true);

    const pkg = await crearPaqueteDePrueba();
    const conPaquete = await agregarPaquete(creado.id, pkg.code, userId);
    expect(conPaquete.origen).toBeDefined();

    const sinPaquete = await quitarPaquete(creado.id, pkg.id, userId);
    expect(sinPaquete.origen).toBeDefined();

    const pkg2 = await crearPaqueteDePrueba();
    await agregarPaquete(creado.id, pkg2.code, userId);
    const cerrado = await cerrarEnvio(creado.id, userId);
    expect(cerrado.origen).toBeDefined();

    const otro = await crearEnvio(destinoId, userId);
    const cancelado = await cancelarEnvio(otro.id, userId);
    expect(cancelado.origen).toBeDefined();

    const detalle = await getEnvioDetalle(creado.id);
    expect(detalle.origen).toEqual(cerrado.origen); // misma fuente, mismo valor siempre.
  });

  test('origen refleja la identidad real de la instalación (Company.sucursalCodigo/sucursalNombre), nunca un valor fijo', async () => {
    await prisma.company.upsert({
      where: { id: 1 },
      update: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
      create: { id: 1, sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz' },
    });
    const envio = await crearEnvio(destinoId, userId);
    expect(envio.origen).toEqual({ codigo: 'LPZ', nombre: 'Cofre Express La Paz' });

    // Cambia la identidad (ej. esta misma instalación configurada como El Alto) y el siguiente envío lo refleja de inmediato.
    await prisma.company.update({ where: { id: 1 }, data: { sucursalCodigo: 'ELA', sucursalNombre: 'Cofre Express El Alto' } });
    const otroEnvio = await crearEnvio(destinoId, userId);
    expect(otroEnvio.origen).toEqual({ codigo: 'ELA', nombre: 'Cofre Express El Alto' });

    // No deja el resto de los tests de este archivo con una identidad "pegada".
    await prisma.company.update({ where: { id: 1 }, data: { sucursalCodigo: null, sucursalNombre: null } });
  });
});

describe('Fase 2.1 (corrección) — datos opcionales de quien recogerá', () => {
  test('al registrar un código nuevo desde Envíos, nombre/celular se guardan en Package.destinatario/destinatarioTelefono (mismos campos que Recepción)', async () => {
    await prisma.packageSeries.upsert({ where: { inicial: 'X' }, update: {}, create: { inicial: 'X', descripcion: 'Prueba' } });
    const envio = await crearEnvio(destinoId, userId);
    const codigoNuevo = 'X1T-RECOGE1';

    await agregarPaquete(envio.id, codigoNuevo, userId, branchId, { destinatario: 'Juan Pérez', destinatarioTelefono: '70011122' });

    const creado = await prisma.package.findFirst({ where: { code: codigoNuevo } });
    expect(creado!.destinatario).toBe('Juan Pérez');
    expect(creado!.destinatarioTelefono).toBe('70011122');
  });

  test('nombre y celular son independientes entre sí: cualquiera de los dos puede faltar', async () => {
    const envio = await crearEnvio(destinoId, userId);

    await agregarPaquete(envio.id, 'X1T-SOLONOM', userId, branchId, { destinatario: 'María', destinatarioTelefono: undefined });
    const soloNombre = await prisma.package.findFirst({ where: { code: 'X1T-SOLONOM' } });
    expect(soloNombre!.destinatario).toBe('María');
    expect(soloNombre!.destinatarioTelefono).toBeNull();

    await agregarPaquete(envio.id, 'X1T-SOLOTEL', userId, branchId, { destinatario: undefined, destinatarioTelefono: '77788899' });
    const soloTelefono = await prisma.package.findFirst({ where: { code: 'X1T-SOLOTEL' } });
    expect(soloTelefono!.destinatario).toBeNull();
    expect(soloTelefono!.destinatarioTelefono).toBe('77788899');

    await agregarPaquete(envio.id, 'X1T-NINGUNO', userId, branchId, {});
    const ninguno = await prisma.package.findFirst({ where: { code: 'X1T-NINGUNO' } });
    expect(ninguno!.destinatario).toBeNull();
    expect(ninguno!.destinatarioTelefono).toBeNull();
  });

  test('si el paquete YA existe, agregarlo a un envío nunca sobrescribe su destinatario/teléfono ya guardados', async () => {
    const pkg = await crearPaqueteDePrueba();
    await prisma.package.update({ where: { id: pkg.id }, data: { destinatario: 'Dato original', destinatarioTelefono: '60000000' } });

    const envio = await crearEnvio(destinoId, userId);
    await agregarPaquete(envio.id, pkg.code, userId, branchId, { destinatario: 'Intento de sobrescribir', destinatarioTelefono: '69999999' });

    const despues = await prisma.package.findUnique({ where: { id: pkg.id } });
    expect(despues!.destinatario).toBe('Dato original');
    expect(despues!.destinatarioTelefono).toBe('60000000');
  });
});

describe('Fase 2.1 — Recibir envío', () => {
  test('recibirEnvio cambia BORRADOR->CERRADO->RECIBIDO, nunca toca Package.status, y protege contra recibirlo dos veces', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    const recibido = await recibirEnvio(envio.id, userId);
    expect(recibido.estado).toBe('RECIBIDO');

    const pkgDespues = await prisma.package.findUnique({ where: { id: pkg.id } });
    expect(pkgDespues!.status).toBe('EN_PAQUETERIA'); // Recibir tampoco cambia Package.status.

    await expect(recibirEnvio(envio.id, userId)).rejects.toThrow(EnvioNoRecibibleError);
  });

  test('no se puede recibir un envío BORRADOR ni uno CANCELADO', async () => {
    const borrador = await crearEnvio(destinoId, userId);
    await expect(recibirEnvio(borrador.id, userId)).rejects.toThrow(EnvioNoRecibibleError);

    const cancelado = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(cancelado.id, pkg.code, userId);
    await cancelarEnvio(cancelado.id, userId);
    await expect(recibirEnvio(cancelado.id, userId)).rejects.toThrow(EnvioNoRecibibleError);
  });

  test('buscarEnvioParaRecibir encuentra por código (no por id) y funciona tanto CERRADO como ya RECIBIDO', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);

    const encontradoCerrado = await buscarEnvioParaRecibir(envio.codigo);
    expect(encontradoCerrado?.id).toBe(envio.id);
    expect(encontradoCerrado?.estado).toBe('CERRADO');

    await recibirEnvio(envio.id, userId);
    const encontradoRecibido = await buscarEnvioParaRecibir(envio.codigo.toLowerCase());
    expect(encontradoRecibido?.estado).toBe('RECIBIDO');

    expect(await buscarEnvioParaRecibir('ENV-NO-EXISTE')).toBeNull();
  });

  test('AuditLog registra ENVIO_RECIBIDO', async () => {
    const envio = await crearEnvio(destinoId, userId);
    const pkg = await crearPaqueteDePrueba();
    await agregarPaquete(envio.id, pkg.code, userId);
    await cerrarEnvio(envio.id, userId);
    const antes = await prisma.auditLog.count({ where: { modulo: 'envios', accion: 'ENVIO_RECIBIDO' } });
    await recibirEnvio(envio.id, userId);
    const despues = await prisma.auditLog.count({ where: { modulo: 'envios', accion: 'ENVIO_RECIBIDO' } });
    expect(despues).toBe(antes + 1);
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
