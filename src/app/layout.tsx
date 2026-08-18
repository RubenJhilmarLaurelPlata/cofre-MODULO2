// src/app/layout.tsx
import type { Metadata } from 'next';
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
