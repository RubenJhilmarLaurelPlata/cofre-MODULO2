// Ancla la TZ del proceso Node a Bolivia por defecto, ANTES de que se
// evalue cualquier otro modulo. Todo el calculo de dias/fechas del
// sistema (pricing.ts: domingos/feriados cobrables; reportes.ts /
// dashboard-data.ts: "hoy/ayer/esta semana"; etiquetas.ts) usa metodos de
// Date nativos (getDate/getDay/setHours), que resuelven "medianoche"
// segun la TZ del proceso — nunca segun Company.zonaHoraria (ese campo es
// solo informativo, no se lee en ningun calculo). Si el sistema operativo
// del servidor no esta en America/La_Paz (ej. una VPS en UTC por
// defecto), un paquete que ingresa despues de las 20:00 hora Bolivia
// (=00:00 UTC) se contaria como ingresado al dia siguiente. Bolivia no
// tiene horario de verano, asi que un valor fijo aqui es seguro todo el
// año. "|| " respeta un TZ ya configurado explicitamente (ej. en .env)
// en vez de pisarlo.
process.env.TZ = process.env.TZ || 'America/La_Paz';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No anunciar el framework/version en el header "X-Powered-By" (Modulo 8: revision de seguridad).
  poweredByHeader: false,
  eslint: {
    dirs: ['src'],
  },
  // Necesario en la linea 14.x para que instrumentation.ts (cierre
  // automatico de caja, ver src/lib/finanzas.ts) se ejecute al arrancar
  // el servidor — sigue siendo "experimental" en esta version especifica,
  // aunque ya es estable/default en versiones mas nuevas de Next.
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
