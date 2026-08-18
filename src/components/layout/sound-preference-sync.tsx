'use client';

// src/components/layout/sound-preference-sync.tsx
// Componente invisible: aplica la preferencia "sonidos activos" (Modulo 7)
// al modulo de sonido apenas se carga el area autenticada, para que
// Recepcion/Deposito/Etiquetas/Buscador respeten la configuracion sin
// tener que consultarla cada uno por su cuenta.
import * as React from 'react';
import { setSonidosActivos } from '@/lib/sound';

export function SoundPreferenceSync({ sonidosActivos }: { sonidosActivos: boolean }) {
  React.useEffect(() => {
    setSonidosActivos(sonidosActivos);
  }, [sonidosActivos]);

  return null;
}
