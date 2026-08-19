// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cofre Express',
  description: 'Sistema de gestión de paquetería Cofre Express',
};

// Next.js 14 (App Router) nunca inyecta un <meta name="viewport"> por su
// cuenta — sin este export, el sistema no tenia NINGUNO, asi que el
// navegador movil caia a su comportamiento por defecto de "sitio de
// escritorio" (viewport virtual ancho, todo renderizado chico y despues
// escalado) — la causa raiz real del "zoom automatico al entrar al
// sistema" reportado. "maximumScale" y "userScalable" se dejan SIN
// definir a proposito: el operador debe poder seguir haciendo pinch-zoom
// manual cuando quiera, lo unico que se corrige es el zoom AUTOMATICO no
// pedido por el usuario.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Aplica el tema guardado (localStorage) antes de que se pinte la
// pagina, para que no haya un "flash" de tema claro antes de pasar a
// oscuro. Corre como script inline sincrono en <head>, antes del <body>.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('cofre-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
