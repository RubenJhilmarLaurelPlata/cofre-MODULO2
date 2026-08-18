/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No anunciar el framework/version en el header "X-Powered-By" (Modulo 8: revision de seguridad).
  poweredByHeader: false,
  eslint: {
    dirs: ['src'],
  },
};

export default nextConfig;
