'use client';

// src/components/configuracion/meses-tab.tsx
// Reutiliza el mismo componente y la misma API (/api/etiquetas/mes-letras)
// que ya construyo el Modulo 5, en vez de duplicar la logica aqui.
import * as React from 'react';
import { MesLetrasConfig } from '@/components/etiquetas/mes-letras-config';

export function MesesTab() {
  const [letras, setLetras] = React.useState<Record<number, string>>({});
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/etiquetas/mes-letras')
      .then((res) => res.json())
      .then(setLetras)
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return <MesLetrasConfig letras={letras} onGuardado={setLetras} sinColapsar />;
}
