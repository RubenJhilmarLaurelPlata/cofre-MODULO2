// tests/plataforma.test.ts
// Unidad pura, sin DOM: esAndroid() (src/lib/scanner/plataforma.ts) es la
// funcion que decide, en camera-scanner.tsx, si un dispositivo debe usar
// zxing directamente (Android/Chrome — ver comentario en ese archivo)
// en vez de intentar primero BarcodeDetector nativo.
import { describe, test, expect } from 'vitest';
import { esAndroid } from '@/lib/scanner/plataforma';

const UA_ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 13; Infinix X6835) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

describe('esAndroid', () => {
  test('user-agent de Chrome en Android real → true', () => {
    expect(esAndroid({ userAgent: UA_ANDROID_CHROME })).toBe(true);
  });

  test('user-agent de Safari en iPhone → false (nunca debe tratarse como Android)', () => {
    expect(esAndroid({ userAgent: UA_IPHONE_SAFARI })).toBe(false);
  });

  test('user-agent de Chrome de escritorio (Mac) → false', () => {
    expect(esAndroid({ userAgent: UA_DESKTOP_CHROME })).toBe(false);
  });

  test('userAgentData.platform ("Android") tiene prioridad sobre el string de user-agent', () => {
    expect(esAndroid({ userAgent: UA_DESKTOP_CHROME, userAgentData: { platform: 'Android' } })).toBe(true);
  });

  test('userAgentData.platform ("macOS") tiene prioridad sobre un user-agent que dijera "Android" por error', () => {
    expect(esAndroid({ userAgent: UA_ANDROID_CHROME, userAgentData: { platform: 'macOS' } })).toBe(false);
  });

  test('sin userAgent ni userAgentData → false, nunca revienta', () => {
    expect(esAndroid({})).toBe(false);
    expect(esAndroid()).toBe(false);
  });
});
