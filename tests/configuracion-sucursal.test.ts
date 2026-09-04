// tests/configuracion-sucursal.test.ts
// Fase 1 (arquitectura multi-sucursal): identidad de instalacion en la
// fila unica de Company. Contra SQLite real de prueba (ver tests/setup.ts)
// — nunca contra prisma/dev.db. Verifica exclusivamente Company: no crea,
// lee ni modifica Package/PackageHistory/Pago (Prueba 7).
import { describe, test, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getCompanyConfig } from '@/lib/config';

describe('Prueba 1 — Company puede tener sucursalCodigo = LPZ', () => {
  test('se crea y se lee correctamente', async () => {
    await prisma.company.create({ data: { id: 1, sucursalCodigo: 'LPZ' } });
    const leido = await prisma.company.findUnique({ where: { id: 1 } });
    expect(leido?.sucursalCodigo).toBe('LPZ');
  });
});

describe('Prueba 2 — sucursalNombre y ciudad son independientes', () => {
  test('ambos valores se guardan sin pisarse entre sí', async () => {
    await prisma.company.update({ where: { id: 1 }, data: { sucursalNombre: 'Cofre Express La Paz', ciudad: 'La Paz' } });
    const leido = await prisma.company.findUnique({ where: { id: 1 } });
    expect(leido?.sucursalNombre).toBe('Cofre Express La Paz');
    expect(leido?.ciudad).toBe('La Paz');
    // La marca general ("nombre") nunca se pisa con la identidad de sucursal.
    expect(leido?.nombre).toBe('Cofre Express'); // default de schema, nunca tocado por esta prueba
  });
});

describe('Prueba 3 — getCompanyConfig() recupera la identidad completa', () => {
  test('incluye sucursalCodigo, sucursalNombre, ciudad, googleMapsUrl, tiktokUrl, whatsapp', async () => {
    const company = await getCompanyConfig();
    expect(company.sucursalCodigo).toBe('LPZ');
    expect(company.sucursalNombre).toBe('Cofre Express La Paz');
    expect(company.ciudad).toBe('La Paz');
    expect(company.googleMapsUrl).toBeNull();
    expect(company.tiktokUrl).toBeNull();
    expect(company.whatsapp).toBeNull();
  });
});

describe('Prueba 4 — actualizar la identidad de sucursal', () => {
  test('los 5 campos nuevos se actualizan y persisten', async () => {
    await prisma.company.update({
      where: { id: 1 },
      data: {
        sucursalCodigo: 'ELA',
        sucursalNombre: 'Cofre Express El Alto',
        googleMapsUrl: 'https://maps.google.com/?q=cofre-express-el-alto',
        tiktokUrl: 'https://tiktok.com/@cofreexpress',
        whatsapp: '+591 700 00000',
      },
    });
    const leido = await prisma.company.findUnique({ where: { id: 1 } });
    expect(leido?.sucursalCodigo).toBe('ELA');
    expect(leido?.sucursalNombre).toBe('Cofre Express El Alto');
    expect(leido?.googleMapsUrl).toBe('https://maps.google.com/?q=cofre-express-el-alto');
    expect(leido?.tiktokUrl).toBe('https://tiktok.com/@cofreexpress');
    expect(leido?.whatsapp).toBe('+591 700 00000');

    // Deja la fila como La Paz otra vez, para no filtrar estado entre pruebas.
    await prisma.company.update({
      where: { id: 1 },
      data: { sucursalCodigo: 'LPZ', sucursalNombre: 'Cofre Express La Paz', googleMapsUrl: null, tiktokUrl: null, whatsapp: null },
    });
  });
});

describe('Prueba 5 — getCompanyConfig() nunca duplica la fila', () => {
  test('llamarla dos veces sigue dejando Company.count() === 1', async () => {
    await getCompanyConfig();
    await getCompanyConfig();
    expect(await prisma.company.count()).toBe(1);
  });
});

describe('Prueba 6 — campos públicos en null no rompen nada', () => {
  test('googleMapsUrl/tiktokUrl/whatsapp en null se leen y serializan sin error', async () => {
    await prisma.company.update({ where: { id: 1 }, data: { googleMapsUrl: null, tiktokUrl: null, whatsapp: null } });
    const company = await getCompanyConfig();
    expect(company.googleMapsUrl).toBeNull();
    expect(company.tiktokUrl).toBeNull();
    expect(company.whatsapp).toBeNull();
    expect(() => JSON.stringify(company)).not.toThrow();
  });
});

describe('Prueba 7 — no toca datos operativos', () => {
  test('Package, PackageHistory y Pago permanecen en 0', async () => {
    expect(await prisma.package.count()).toBe(0);
    expect(await prisma.packageHistory.count()).toBe(0);
    expect(await prisma.pago.count()).toBe(0);
  });
});
