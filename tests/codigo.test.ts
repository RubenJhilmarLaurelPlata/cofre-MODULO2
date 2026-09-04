// tests/codigo.test.ts
// Unidad pura, sin base de datos: src/lib/codigo.ts es el único punto de
// normalización del lado del cliente, compartido por camera-scanner.tsx
// (los 4 escáneres de Code128 + el QR de "Envíos -> Recibir envío") y por
// la entrada manual de cada pantalla. Fase 4.1 corrige un bug real de
// producción: el payload de QR "codigo|qrToken" se normalizaba COMPLETO
// (incluido el token, un crypto.randomUUID() en minúsculas comparado con
// === contra la BD — ver buscarEnvioParaRecibir() en src/lib/envios.ts),
// así que un QR real y correctamente detectado terminaba resolviendo
// "no encontrado" porque el token le llegaba al backend en mayúsculas.
import { describe, test, expect } from 'vitest';
import { normalizarEntradaEscaneo } from '@/lib/codigo';

describe('normalizarEntradaEscaneo — separación código/qrToken', () => {
  test('A. payload "codigo|qrToken" (token en minúsculas, como lo genera crypto.randomUUID()): normaliza el código, preserva el token intacto', () => {
    const token = '8fe33691-5173-4edd-bd6c-ce73ee30cf29';
    expect(normalizarEntradaEscaneo(`env-20260904-008|${token}`)).toBe(`ENV-20260904-008|${token}`);
  });

  test('B. el token nunca se re-normaliza aunque ya venga en mayúsculas — no se le aplican separadores equivalentes ni mayúsculas de nuevo', () => {
    const token = '8FE33691-5173-4EDD-BD6C-CE73EE30CF29';
    expect(normalizarEntradaEscaneo(`ENV-20260904-008|${token}`)).toBe(`ENV-20260904-008|${token}`);
  });

  test('C. entrada manual (código exacto, sin "|") sigue funcionando exactamente igual que antes', () => {
    expect(normalizarEntradaEscaneo('env-20260904-008')).toBe('ENV-20260904-008');
    expect(normalizarEntradaEscaneo("l17a'29")).toBe('L17A-29'); // separadores equivalentes de lectores HID
  });

  test('D. payload sin "|" nunca genera un token accidental', () => {
    expect(normalizarEntradaEscaneo('ENV-20260904-008')).not.toContain('|');
  });

  test('E. payload malformado ("|" al inicio, sin código) no revienta — produce un código vacío que el backend rechaza como no encontrado', () => {
    expect(() => normalizarEntradaEscaneo('|8fe33691-5173-4edd-bd6c-ce73ee30cf29')).not.toThrow();
    expect(normalizarEntradaEscaneo('|8fe33691-5173-4edd-bd6c-ce73ee30cf29')).toBe('|8fe33691-5173-4edd-bd6c-ce73ee30cf29');
  });

  test('F. separadores equivalentes del código (antes del "|") se siguen canonicalizando; el token después del "|" nunca se toca', () => {
    const token = 'abc-DEF-123';
    expect(normalizarEntradaEscaneo(`env-20260904'008|${token}`)).toBe(`ENV-20260904-008|${token}`);
  });

  test('espacios sobrantes alrededor de todo el payload se recortan', () => {
    const token = '8fe33691-5173-4edd-bd6c-ce73ee30cf29';
    expect(normalizarEntradaEscaneo(`  ENV-20260904-008|${token}  `)).toBe(`ENV-20260904-008|${token}`);
  });
});
