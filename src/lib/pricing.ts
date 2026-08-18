// src/lib/pricing.ts
// Reglas de negocio de tarifas y dias de almacenamiento, tal como las
// define la especificacion: tarifa base + dias incluidos + costo adicional
// por dia, sin contar domingos ni feriados configurados.

export function toDateOnly(d: Date | string): Date {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

export function dateKey(d: Date | string): string {
  const x = toDateOnly(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

export function diasTranscurridos(ingresoAt: Date | string, hastaAt: Date | string): number {
  const ingresoDate = toDateOnly(ingresoAt);
  const hastaDate = toDateOnly(hastaAt);
  const diff = Math.round((hastaDate.getTime() - ingresoDate.getTime()) / 86400000);
  return Math.max(diff, 0);
}

export interface ReglasTarifa {
  tarifaBase: number;
  diasIncluidos: number;
  costoAdicionalDia: number;
}

export interface CostoCalculado {
  dias: number;
  tarifaBase: number;
  diasCobrablesExtra: number;
  costoExtra: number;
  total: number;
}

/**
 * Calcula el costo acumulado de un paquete a una fecha de referencia.
 * @param ingresoAt fecha/hora de ingreso del paquete
 * @param hastaAt fecha de referencia (hoy, o la fecha de entrega/denegado si ya se congelo)
 * @param reglas tarifa base, dias incluidos y costo por dia adicional
 * @param feriados set de fechas (YYYY-MM-DD) que no se cobran
 * @param tarifaBaseOverride tarifa especial para este paquete puntual, si existe
 * @param diasIncluidosOverride dias incluidos propios del lote/codigo de este paquete, si existe (Fase 4B)
 */
export function calcularCosto(
  ingresoAt: Date | string,
  hastaAt: Date | string,
  reglas: ReglasTarifa,
  feriados: Set<string>,
  tarifaBaseOverride?: number | null,
  diasIncluidosOverride?: number | null
): CostoCalculado {
  const tarifaBase = tarifaBaseOverride ?? reglas.tarifaBase;
  const diasIncluidos = diasIncluidosOverride ?? reglas.diasIncluidos;
  const dias = diasTranscurridos(ingresoAt, hastaAt);

  let diasCobrablesExtra = 0;
  for (let i = diasIncluidos + 1; i <= dias; i++) {
    const fecha = new Date(toDateOnly(ingresoAt));
    fecha.setDate(fecha.getDate() + i);
    if (isSunday(fecha)) continue;
    if (feriados.has(dateKey(fecha))) continue;
    diasCobrablesExtra++;
  }

  const costoExtra = diasCobrablesExtra * reglas.costoAdicionalDia;
  const total = Math.round((tarifaBase + costoExtra) * 100) / 100;

  return { dias, tarifaBase, diasCobrablesExtra, costoExtra, total };
}
