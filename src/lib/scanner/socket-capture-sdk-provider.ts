// src/lib/scanner/socket-capture-sdk-provider.ts
//
// Superado por src/lib/scanner/capture-js-provider.ts (Paso V3): ahi vive
// la integracion real con Socket Mobile Capture JS. Este archivo se deja
// como reexportacion para no romper ningun import existente.
export { captureJsScannerProvider as socketCaptureSDKProvider, configurarS700, onEscaneoCaptureJs } from '@/lib/scanner/capture-js-provider';
