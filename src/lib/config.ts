// src/lib/config.ts
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import type { Company } from '@prisma/client';

/**
 * Trae (y crea si no existe) la fila unica de configuracion de la
 * empresa. Envuelta en React.cache(): dentro de la MISMA request, varias
 * partes del codigo llaman esto por separado (ej. registrarPago,
 * getPackageDetail y la ruta que los invoca a los dos), y sin esto cada
 * una repetiria la consulta a la base de datos. Cada request nueva
 * vuelve a consultar de cero (Modulo 8 uso el mismo patron para
 * getSession(), donde ya se verifico que esto no compromete que un
 * cambio de configuracion se refleje de inmediato en la siguiente
 * request). Nunca se importa desde middleware.ts (Edge Runtime), asi que
 * usar React.cache() aqui es seguro.
 */
export const getCompanyConfig = cache(async (): Promise<Company> => {
  const existing = await prisma.company.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.company.create({ data: { id: 1 } });
});

/** Set de fechas (YYYY-MM-DD) marcadas como feriado activo. Tambien deduplicada por request, ver getCompanyConfig(). */
export const getHolidaySet = cache(async (): Promise<Set<string>> => {
  const holidays = await prisma.holiday.findMany({
    where: { activo: true },
    select: { fecha: true },
  });
  return new Set(holidays.map((h) => h.fecha));
});
