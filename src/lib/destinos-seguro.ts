// src/lib/destinos-seguro.ts
// Fase 5.3B (corrección de un hallazgo de seguridad de la auditoría de
// Fase 5.1): SucursalDestino guarda, desde Fase 4.1, credenciales HMAC
// (apiKeySaliente/apiKeyEntrante) — GET /api/configuracion/destinos y
// PATCH /api/configuracion/destinos/[id] devolvían la fila COMPLETA de
// Prisma (sin ningún `select`), exponiendo esos dos secretos a cualquier
// usuario con el permiso `envios.ver` (el mínimo para simplemente ver la
// lista de envíos, no uno administrativo) — y también los guardaban en
// texto plano en AuditLog.valorAnterior/valorNuevo, legible por cualquiera
// con acceso a auditoría.
//
// Un único `select` compartido, reutilizado por los 3 endpoints que
// tocan SucursalDestino (GET lista, POST crear, PATCH actualizar) — así
// una futura columna sensible nueva en este modelo no puede filtrarse
// por accidente en un solo lugar que alguien olvide actualizar: agregar
// un campo a SucursalDestino nunca lo expone aquí a menos que se agregue
// explícitamente a esta lista.
import { Prisma } from '@prisma/client';

export const DESTINO_SELECT_SEGURO = {
  id: true,
  codigo: true,
  nombre: true,
  ciudad: true,
  direccion: true,
  activa: true,
  createdAt: true,
  updatedAt: true,
  // apiUrlSaliente: informativo (una URL, no un secreto de autenticación)
  // — la instrucción de esta fase solo pide ocultar apiKeySaliente/
  // apiKeyEntrante, nunca la URL, así que un admin sigue pudiendo
  // verificar hacia dónde apunta la comunicación configurada.
  apiUrlSaliente: true,
  // Deliberadamente OMITIDOS: apiKeySaliente, apiKeyEntrante — nunca
  // deben viajar en ninguna respuesta HTTP ni quedar en AuditLog.
} satisfies Prisma.SucursalDestinoSelect;

export type DestinoSeguroDTO = Prisma.SucursalDestinoGetPayload<{ select: typeof DESTINO_SELECT_SEGURO }>;
