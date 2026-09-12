// src/lib/tracking/cliente-interop.ts
// Fase 5.3-HARDENING (paquetes inter-sucursal — ver informe, sección 3):
// cliente saliente para DELEGAR un evento de tracking hacia la
// instalación de ORIGEN de un paquete transferido, cuando ESTA
// instalación (el destino) no puede firmarlo honestamente ella misma
// (Tracking exige que el firmante HMAC coincida con "origenSucursalCodigo"
// del payload — ver src/lib/tracking/eventos.ts). Reutiliza el MISMO
// protocolo HMAC de src/lib/interop/ (nunca reimplementa firma), y las
// MISMAS credenciales que ya existen para hablar con esa instalación
// (SucursalDestino.apiUrlSaliente/apiKeySaliente, Fase 4.1) — nunca una
// identidad ni un secreto nuevo.
//
// A diferencia de src/lib/tracking/cliente.ts (que solo lee variables de
// entorno, sin tocar la base), este cliente SÍ necesita resolver
// SucursalDestino/Company — la credencial correcta depende de A QUIÉN se
// delega, algo que solo la base local sabe.
import { prisma } from '@/lib/prisma';
import { crearHeadersInterop } from '@/lib/interop/headers';

export type ResultadoDelegacion = { ok: true } | { ok: false; motivo: 'SIN_CREDENCIALES' | 'SIN_IDENTIDAD' | 'RED' | 'RECHAZADO'; detalle: string };

export interface EnviarDelegacionInput {
  /** Company.sucursalCodigo de la instalación de ORIGEN a la que se delega (= OutboxEvent.origenSucursalCodigo de la fila). */
  origenSucursalCodigo: string;
  /** El body EXACTO ya serializado (ver src/lib/tracking/eventos.ts, encolarDelegacionInterop()). */
  payloadJson: string;
  fetchImpl?: typeof fetch;
}

const PATH_EVENTOS_DELEGADOS = '/api/interop/tracking/eventos';

/**
 * NUNCA lanza — igual que cliente.ts, siempre devuelve un resultado
 * clasificado para que el worker decida qué hacer sin try/catch, y para
 * que ningún secreto pueda terminar en OutboxEvent.lastError.
 */
export async function enviarDelegacionAOrigen(input: EnviarDelegacionInput): Promise<ResultadoDelegacion> {
  const [destino, company] = await Promise.all([
    prisma.sucursalDestino.findUnique({ where: { codigo: input.origenSucursalCodigo }, select: { apiUrlSaliente: true, apiKeySaliente: true } }),
    prisma.company.findUnique({ where: { id: 1 }, select: { sucursalCodigo: true } }),
  ]);
  if (!destino?.apiUrlSaliente || !destino?.apiKeySaliente) {
    return { ok: false, motivo: 'SIN_CREDENCIALES', detalle: `Sin apiUrlSaliente/apiKeySaliente configurados para "${input.origenSucursalCodigo}".` };
  }
  if (!company?.sucursalCodigo) {
    return { ok: false, motivo: 'SIN_IDENTIDAD', detalle: 'Esta instalación no tiene Company.sucursalCodigo configurado.' };
  }

  const url = new URL(PATH_EVENTOS_DELEGADOS, destino.apiUrlSaliente).toString();
  const headers = crearHeadersInterop({
    sucursalCodigo: company.sucursalCodigo,
    secreto: destino.apiKeySaliente,
    method: 'POST',
    path: PATH_EVENTOS_DELEGADOS,
    body: input.payloadJson,
  });

  const fetchFn = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: input.payloadJson });
  } catch (err) {
    return { ok: false, motivo: 'RED', detalle: err instanceof Error ? err.message : 'Error de red desconocido.' };
  }

  if (res.ok) return { ok: true };
  return { ok: false, motivo: 'RECHAZADO', detalle: `HTTP ${res.status}` };
}
