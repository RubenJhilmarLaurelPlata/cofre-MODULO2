// tests/zbar-code128.test.ts
//
// Fase 4.5 — prueba critica pedida explicitamente: decodificar una imagen
// REAL de Code128 (nunca una tabla de barras inventada a mano) con la
// MISMA libreria que se integro en produccion (@undecaf/zbar-wasm, sin
// mockear en absoluto), y confirmar que el texto devuelto es EXACTAMENTE
// el esperado.
//
// La imagen se genera con bwip-js (ya es dependencia real del proyecto,
// usada en src/lib/etiquetas-pdf.ts para las etiquetas que se imprimen) —
// un encoder de codigo de barras genuino y ya confiado por esta
// aplicacion, no una implementacion propia. bwip-js entrega el PNG con
// fondo TRANSPARENTE (tinta = alfa, no un canal de color) porque esta
// pensado para componerse sobre una etiqueta; aqui se compone sobre
// blanco para obtener una imagen normal, exactamente como se veria ya
// impresa. pngjs (puro JS, sin dependencias nativas) decodifica el PNG a
// RGBA crudo — no se usa canvas nativo en absoluto, evitando el problema
// ya conocido en este entorno de que `canvas` no compila (ver commit
// anterior de esta misma investigacion).
//
// No se prueba aqui el envoltorio de produccion (src/lib/scanner/zbar.ts)
// tal cual: ese modulo asume un navegador real (fetch de /zbar.wasm
// servido por Next, ImageData de un canvas) y no tiene sentido en un test
// de Node puro. Lo que SI prueba este archivo es la pieza que de verdad
// estaba en duda — si ZBar, la libreria concreta que se integro, puede
// leer un Code128 real de camara — con la carga/config identica a la que
// usa production (ZBAR_CODE128 habilitado en exclusiva, igual que
// obtenerScannerZbar() en zbar.ts). La integracion browser-especifica
// (getImageData, locateFile, orquestacion con el pipeline de la camara)
// se prueba por separado en tests/camera-scanner.test.ts (mockeada, igual
// que ya se hacia con @zxing/library) y requiere, ademas, una prueba
// fisica en el telefono real (ver informe).
import { describe, test, expect, beforeAll } from 'vitest';
import bwipjs from 'bwip-js/node';
import { PNG } from 'pngjs';
import { ZBarScanner, ZBarSymbolType, ZBarConfigType, scanRGBABuffer } from '@undecaf/zbar-wasm';

const TEXTO_ESPERADO = 'Q03T-205';

interface ImagenRGBA {
  data: Buffer;
  width: number;
  height: number;
}

function generarCode128Png(texto: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({ bcid: 'code128', text: texto, scale: 4, height: 12, includetext: true, textxalign: 'center' }, (err, png) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(png);
    });
  });
}

function pngARGBA(buf: Buffer): ImagenRGBA {
  const png = PNG.sync.read(buf);
  // bwip-js: RGB siempre (0,0,0), el alfa es lo que distingue tinta de
  // fondo — se compone sobre blanco (alfa=255 "tinta" -> negro, alfa=0
  // "fondo" -> blanco) para obtener una imagen opaca normal.
  const out = Buffer.alloc(png.data.length);
  for (let i = 0; i < png.data.length; i += 4) {
    const v = 255 - png.data.readUInt8(i + 3);
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width: png.width, height: png.height };
}

function rotar90(img: ImagenRGBA): ImagenRGBA {
  const w2 = img.height;
  const h2 = img.width;
  const out = Buffer.alloc(w2 * h2 * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const dx = img.height - 1 - y;
      const dy = x;
      const di = (dy * w2 + dx) * 4;
      img.data.copy(out, di, si, si + 4);
    }
  }
  return { data: out, width: w2, height: h2 };
}

function shearHorizontal(img: ImagenRGBA, maxShearPx: number): ImagenRGBA {
  const w2 = img.width + maxShearPx;
  const out = Buffer.alloc(w2 * img.height * 4, 255);
  for (let y = 0; y < img.height; y++) {
    const offset = Math.round((maxShearPx * y) / img.height);
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const di = (y * w2 + (x + offset)) * 4;
      img.data.copy(out, di, si, si + 4);
    }
  }
  return { data: out, width: w2, height: img.height };
}

// Misma configuracion EXACTA que obtenerScannerZbar() en
// src/lib/scanner/zbar.ts: deshabilitar todas las simbologias y habilitar
// solo Code128 — decoder especializado, no generico.
async function crearScannerDeProduccion() {
  const scanner = await ZBarScanner.create();
  scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
  return scanner;
}

async function decodificar(img: ImagenRGBA, scanner: ZBarScanner) {
  const arrayBuffer = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength);
  const simbolos = await scanRGBABuffer(arrayBuffer, img.width, img.height, scanner);
  return simbolos.filter((s) => s.type === ZBarSymbolType.ZBAR_CODE128).map((s) => s.decode());
}

describe('ZBar/WASM decodifica un Code128 REAL (Fase 4.5 — prueba critica, sin mocks)', () => {
  let original: ImagenRGBA;
  let scanner: ZBarScanner;

  beforeAll(async () => {
    const png = await generarCode128Png(TEXTO_ESPERADO);
    original = pngARGBA(png);
    scanner = await crearScannerDeProduccion();
  });

  test(`imagen original: decodifica exactamente "${TEXTO_ESPERADO}"`, async () => {
    const resultados = await decodificar(original, scanner);
    expect(resultados).toEqual([TEXTO_ESPERADO]);
  });

  test('imagen con perspectiva/shear leve (simula una foto no perfectamente perpendicular): sigue decodificando correctamente', async () => {
    const resultados = await decodificar(shearHorizontal(original, 20), scanner);
    expect(resultados).toEqual([TEXTO_ESPERADO]);
  });

  test('imagen con perspectiva/shear fuerte: sigue decodificando correctamente', async () => {
    const resultados = await decodificar(shearHorizontal(original, 40), scanner);
    expect(resultados).toEqual([TEXTO_ESPERADO]);
  });

  test('imagen rotada 90° (etiqueta sostenida "de lado", el caso que zxing nunca resolvia): ZBar la decodifica SIN ningun intento manual de rotacion', async () => {
    const resultados = await decodificar(rotar90(original), scanner);
    expect(resultados).toEqual([TEXTO_ESPERADO]);
  });

  test('un codigo distinto genera un texto distinto (control negativo: no es un resultado fijo/hardcodeado)', async () => {
    const otraPng = await generarCode128Png('M02S-20');
    const otraImg = pngARGBA(otraPng);
    const resultados = await decodificar(otraImg, scanner);
    expect(resultados).toEqual(['M02S-20']);
  });
});
