// src/lib/meses.ts
// Nombres de los meses (Enero..Diciembre) en su propio modulo, sin
// importar nada de Prisma, para que componentes de cliente (ej.
// MesLetrasConfig) puedan usarlos sin arrastrar el cliente de base de
// datos al bundle del navegador (@/lib/etiquetas.ts si importa Prisma).
export const MESES_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
