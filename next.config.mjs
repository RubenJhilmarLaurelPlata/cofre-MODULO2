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
