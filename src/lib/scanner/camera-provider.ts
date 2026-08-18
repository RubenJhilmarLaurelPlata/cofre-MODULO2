'use client';

// src/lib/scanner/camera-provider.ts
// A diferencia del provider HID, aqui el estado SI se conoce con certeza:
// CameraScanner llama setCameraActiva(true/false) cuando la camara
// realmente se activa/apaga (permiso concedido, stream iniciado o
// detenido). No es una heuristica.
import type { ScannerProvider, ScannerConnectionState } from '@/lib/scanner/types';

let activa = false;
const listeners = new Set<(state: ScannerConnectionState) => void>();

export function setCameraActiva(nuevoValor: boolean) {
  activa = nuevoValor;
  const estado = activa ? 'conectado' : 'no-detectado';
  listeners.forEach((l) => l(estado));
}

export const cameraScannerProvider: ScannerProvider = {
  id: 'camera',
  label: 'Cámara',
  getConnectionState: () => (activa ? 'conectado' : 'no-detectado'),
  subscribe(onChange) {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  },
};
