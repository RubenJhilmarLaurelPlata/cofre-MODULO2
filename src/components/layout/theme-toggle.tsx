'use client';

// src/components/layout/theme-toggle.tsx
// Selector de tema claro/oscuro. La preferencia se guarda en localStorage
// (no depende del servidor ni de sesion) y se aplica agregando/quitando
// la clase "dark" en <html>, que es lo que activan todas las variantes
// dark: de Tailwind en toda la aplicacion. El script inline en
// src/app/layout.tsx ya aplica la clase correcta antes del primer pintado
// para evitar el "flash" de tema incorrecto; este componente solo
// necesita leer ese estado inicial y ofrecer el boton para alternarlo.
import * as React from 'react';
import { Sun, Moon } from 'lucide-react';

const STORAGE_KEY = 'cofre-theme';

export function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function alternar() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Si localStorage no esta disponible (modo privado, etc.), el tema
      // simplemente no persiste entre recargas — no es un error fatal.
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-gray-100 hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />}
    </button>
  );
}
