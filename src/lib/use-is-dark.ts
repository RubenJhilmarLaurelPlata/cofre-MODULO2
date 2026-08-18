'use client';

// src/lib/use-is-dark.ts
// Librerias como Recharts no aceptan clases de Tailwind para sus colores
// (ejes, grillas, tooltip): necesitan el valor hex directo. Este hook
// observa la clase "dark" en <html> (la misma que activa el resto de la
// app via las variantes dark: de Tailwind, ver ThemeToggle) para que esos
// componentes puedan elegir la paleta correcta.
import * as React from 'react';

export function useIsDark(): boolean {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    const actualizar = () => setIsDark(root.classList.contains('dark'));
    actualizar();
    const observer = new MutationObserver(actualizar);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
