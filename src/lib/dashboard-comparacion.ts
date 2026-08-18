// src/lib/dashboard-comparacion.ts
// Comparaciones reales del Dashboard (Fase 4A): nunca inventa un
// porcentaje. Si el periodo anterior fue 0, el cambio porcentual no esta
// definido (dividir entre cero) — se devuelve null y el componente
// muestra explicitamente "Sin datos suficientes" en vez de "+Infinity%"
// o inventar un numero.
export interface Variacion {
  texto: string;
  positiva: boolean;
}

export function calcularVariacion(actual: number, anterior: number): Variacion | null {
  if (anterior === 0) return null;
  const cambio = ((actual - anterior) / anterior) * 100;
  const redondeado = Math.round(cambio);
  return { texto: `${redondeado >= 0 ? '+' : ''}${redondeado}%`, positiva: redondeado >= 0 };
}
