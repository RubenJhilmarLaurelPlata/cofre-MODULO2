// scripts/tracking-worker.ts
// Fase 5.3H: proceso standalone que vacía el Outbox de tracking en
// intervalos cortos. Un solo proceso PM2 por sucursal alcanza para esta
// fase (ver informe) — nada de infraestructura distribuida nueva.
//
// Uso:
//   npx tsx scripts/tracking-worker.ts            (un solo lote y termina)
//   npx tsx scripts/tracking-worker.ts --loop      (procesa cada INTERVALO_MS, para siempre)
//
// El bucle de --loop vive AQUI (un proceso de fondo dedicado), nunca
// dentro de una request de usuario — ver worker.ts, comentario de
// "antipatron prohibido".
import { procesarLoteOutbox } from '@/lib/tracking/worker';

const INTERVALO_MS = 15_000;

async function unLote() {
  const resultado = await procesarLoteOutbox();
  if (resultado.procesados > 0) {
    console.log(`[tracking-worker] procesados=${resultado.procesados} enviados=${resultado.enviados} fallidos=${resultado.fallidos}`);
  }
  return resultado;
}

async function main() {
  const loop = process.argv.includes('--loop');
  if (!loop) {
    await unLote();
    return;
  }

  console.log(`[tracking-worker] iniciado en modo --loop (cada ${INTERVALO_MS / 1000}s)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await unLote().catch((err) => console.error('[tracking-worker] error procesando lote:', err));
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
  }
}

main().catch((err) => {
  console.error('[tracking-worker] error fatal:', err);
  process.exit(1);
});
