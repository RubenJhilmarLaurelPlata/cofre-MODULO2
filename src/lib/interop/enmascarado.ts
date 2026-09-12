// src/lib/interop/enmascarado.ts
// Fase 4.2 (requisito de seguridad explícito: "no registrar secretos ni
// firmas completas en logs"): este módulo de interop, tal cual, no hace
// NINGÚN logging por su cuenta — ningún console.log en toda la carpeta.
// Este helper existe para que, cuando la Fase 4.3 agregue auditoría de
// requests entrantes/salientes, tenga a mano una forma segura de anotar
// "qué firma/secreto se usó" sin exponerlo completo.
export function enmascararValorSensible(valor: string): string {
  if (valor.length <= 8) return '•'.repeat(valor.length);
  return `${valor.slice(0, 4)}…${valor.slice(-4)} (${valor.length} chars)`;
}
