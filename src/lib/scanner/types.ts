// src/lib/scanner/types.ts
// Arquitectura de proveedores de escaneo: Recepcion y Entrega no deben
// depender de un metodo de lectura en particular. Hoy el metodo real y
// universal es HID (el lector se comporta como un teclado: escribe el
// codigo en el campo enfocado y termina con Enter — asi funciona el
// Socket Mobile S700 en su modo por defecto). La camara es el segundo
// metodo. Un futuro provider para el CaptureSDK propietario de Socket
// Mobile puede agregarse sin tocar las pantallas de Recepcion/Entrega,
// siempre que implemente esta misma interfaz.
export type ScannerConnectionState = 'conectado' | 'conectando' | 'no-detectado';

export interface ScannerProvider {
  readonly id: 'hid' | 'camera' | 'socket-capture-sdk';
  readonly label: string;
  getConnectionState(): ScannerConnectionState;
  /** Se llama cuando cambia el estado; devuelve una funcion para dejar de escuchar. */
  subscribe(onChange: (state: ScannerConnectionState) => void): () => void;
  /** Nombre del dispositivo fisico, si el proveedor lo conoce (solo CaptureSDK: HID no puede saberlo, ver hid-provider.ts). */
  getDeviceName?(): string | null;
  /** Ultimo error real (mensaje para mostrar al usuario), si el proveedor lo expone. Null si no hubo error o no aplica. */
  getUltimoError?(): string | null;
}
