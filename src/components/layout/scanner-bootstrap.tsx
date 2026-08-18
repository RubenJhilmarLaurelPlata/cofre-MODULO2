'use client';

// src/components/layout/scanner-bootstrap.tsx
// Componente invisible: si el administrador configuro credenciales de
// Socket Mobile CaptureSDK (ver Configuracion → Lector S700), inicializa
// la conexion UNA sola vez apenas se carga el area autenticada, para que
// Recepcion/Entrega/Buscador ya la encuentren lista sin repetir la carga
// del SDK en cada pantalla. Si no esta habilitado, no hace nada — el
// sistema sigue funcionando enteramente en modo HID.
import * as React from 'react';
import { configurarS700 } from '@/lib/scanner/capture-js-provider';

interface ScannerBootstrapProps {
  habilitado: boolean;
  appId: string | null;
  developerId: string | null;
  appKey: string | null;
}

export function ScannerBootstrap({ habilitado, appId, developerId, appKey }: ScannerBootstrapProps) {
  React.useEffect(() => {
    if (habilitado && appId && developerId && appKey) {
      configurarS700({ appId, developerId, appKey });
    } else {
      configurarS700(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, appId, developerId, appKey]);

  return null;
}
