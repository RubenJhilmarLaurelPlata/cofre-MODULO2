// src/instrumentation.ts
// Next.js 14 ejecuta register() una sola vez al arrancar el servidor
// (requiere experimental.instrumentationHook en next.config.mjs en esta
// version — confirmado, ver verificacion real en la sesion que agrego
// esto). Corre en el mismo proceso Node persistente que ya administra
// PM2, asi que no hace falta ningun cron externo ni tocar PM2/Nginx.
//
// Unico uso actual: cierre automatico de caja (Configuracion > Tarifas >
// "Cierre automático"). Revisa cada 60s si corresponde cerrar — nunca
// bloquea el arranque del servidor, nunca lanza si algo falla adentro
// (ver el try/catch propio de verificarCierreAutomatico en
// src/lib/finanzas.ts).
const INTERVALO_MS = 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { verificarCierreAutomatico } = await import('@/lib/finanzas');
  console.log('[instrumentation] Verificador de cierre automático de caja iniciado.');
  setInterval(() => {
    verificarCierreAutomatico();
  }, INTERVALO_MS);
}
