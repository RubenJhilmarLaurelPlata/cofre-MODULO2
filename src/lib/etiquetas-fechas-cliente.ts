// src/lib/etiquetas-fechas-cliente.ts
// Mismo calculo de fechas que calcularFechasLote() en src/lib/etiquetas.ts
// (Hoy/Mañana/Fecha específica/Semana/Rango), pero en una version pura
// sin Prisma para poder usarse del lado del cliente (vista previa en
// generar-tab.tsx y generar-pdf-tab.tsx) sin pedirle nada al servidor. La
// generacion real SIEMPRE se valida y ejecuta en el servidor (este modulo
// nunca escribe nada) — esto es solo para que la vista previa muestre,
// sin esperar una respuesta de red, el mismo resultado que va a producir
// el servidor. Mismo criterio ya usado en generar-pdf-tab.tsx para
// duplicar construirCodigo() del lado del cliente.

export type ModoFechaCliente = 'hoy' | 'manana' | 'especifica' | 'semana' | 'rango';

export function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mananaStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDateOnlyStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export interface ParametrosFechaCliente {
  modo: ModoFechaCliente;
  fecha: string; // usado si modo === 'especifica'
  fechaReferencia: string; // usado si modo === 'semana'
  fechaInicio: string; // usado si modo === 'rango'
  fechaFin: string; // usado si modo === 'rango'
}

/** Lista completa de fechas (YYYY-MM-DD) para el modo elegido — misma logica exacta que calcularFechasLote() del servidor (incluida la semana lunes->sabado). */
export function calcularFechasCliente(params: ParametrosFechaCliente): string[] {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  switch (params.modo) {
    case 'hoy':
      return [toDateOnlyStr(hoy)];
    case 'manana': {
      const m = new Date(hoy);
      m.setDate(m.getDate() + 1);
      return [toDateOnlyStr(m)];
    }
    case 'especifica':
      return params.fecha ? [params.fecha] : [];
    case 'semana': {
      if (!params.fechaReferencia) return [];
      const ref = parseDateOnly(params.fechaReferencia);
      const diasDesdeLunes = (ref.getDay() + 6) % 7;
      const inicioSemana = new Date(ref);
      inicioSemana.setDate(ref.getDate() - diasDesdeLunes);
      const dias: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(inicioSemana);
        d.setDate(inicioSemana.getDate() + i);
        dias.push(toDateOnlyStr(d));
      }
      return dias;
    }
    case 'rango': {
      if (!params.fechaInicio || !params.fechaFin) return [];
      const inicio = parseDateOnly(params.fechaInicio);
      const fin = parseDateOnly(params.fechaFin);
      if (fin < inicio) return [];
      const dias: string[] = [];
      const cursor = new Date(inicio);
      let guard = 0;
      while (cursor <= fin && guard < 500) {
        dias.push(toDateOnlyStr(cursor));
        cursor.setDate(cursor.getDate() + 1);
        guard++;
      }
      return dias;
    }
  }
}
