// src/app/api/interop/tracking/eventos/route.ts
// Fase 5.3-HARDENING: este endpoint corre en la instalación de ORIGEN de
// una transferencia — la sucursal DESTINO le pide (autenticada por HMAC,
// mismo protocolo que el resto de /api/interop) que reporte a Tracking,
// EN SU PROPIO NOMBRE, una transición ocurrida sobre un paquete que ella
// materializó por interop (Fase 4.4). Regla fundamental (igual que el
// resto de /api/interop): ninguna sucursal escribe directamente en la
// base de otra — el destino solicita, el origen valida y decide.
//
// Por qué existe: Tracking exige que la sucursal autenticada por HMAC
// coincida exactamente con "origenSucursalCodigo" del payload (ver
// auditoría Fase 5.1/5.3) — el destino de una transferencia NUNCA puede
// firmar honestamente un evento cuyo origen declarado es otra
// instalación, así que delega el reporte hacia quien sí puede.
//
// Qué SÍ hace: valida HMAC, identifica al solicitante, exige el body
// documentado en SolicitudDelegacionTracking, y si la transferencia/
// destino/paquete son legítimos, encola (Outbox local de ESTA
// instalación) el evento final ya firmable como origen — nunca llama a
// Tracking sincrónicamente aquí (eso lo hace el worker de esta
// instalación, después, igual que cualquier otro evento).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verificarRequestInteropNext } from '@/lib/interop/adaptador-next';
import { resolverApiKeyEntrante, registrarEventoTrackingDelegado } from '@/lib/interop-envios';

export const runtime = 'nodejs';

const bodySchema = z.object({
  transferenciaId: z.string().trim().min(1),
  origenCodigoPaquete: z.string().trim().min(1),
  reporteId: z.string().trim().min(1),
  tipoEvento: z.literal('PAQUETE_TRANSICION'),
  estadoInternoOrigen: z.string().trim().min(1),
  fechaOrigen: z.string().datetime({ offset: true }).or(z.string().min(1)),
});

export async function POST(req: NextRequest) {
  const { resultado, body } = await verificarRequestInteropNext(req, { resolverSecreto: resolverApiKeyEntrante });

  if (!resultado.ok) {
    // Mismo criterio que el resto de /api/interop: un único mensaje/código
    // para los 4 motivos posibles de fallo de autenticación.
    return NextResponse.json({ error: 'Autenticación inválida.' }, { status: 401 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = body ? JSON.parse(body) : null;
  } catch {
    bodyJson = null;
  }
  const parsed = bodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const fechaOrigen = new Date(parsed.data.fechaOrigen);
  if (Number.isNaN(fechaOrigen.getTime())) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const resultadoDelegacion = await registrarEventoTrackingDelegado(
    {
      transferenciaId: parsed.data.transferenciaId,
      origenCodigoPaquete: parsed.data.origenCodigoPaquete,
      reporteId: parsed.data.reporteId,
      tipoEvento: parsed.data.tipoEvento,
      estadoInternoOrigen: parsed.data.estadoInternoOrigen,
      fechaOrigen,
    },
    resultado.sucursalCodigo
  );

  if (!resultadoDelegacion.ok) {
    if (resultadoDelegacion.motivo === 'NO_ENCONTRADO') {
      return NextResponse.json({ error: 'No se encontró ninguna transferencia con ese identificador.' }, { status: 404 });
    }
    if (resultadoDelegacion.motivo === 'ESTADO_INVALIDO') {
      return NextResponse.json({ error: 'Este envío no está en un estado que admita reportes posteriores.' }, { status: 409 });
    }
    // NO_ES_DESTINO y PAQUETE_NO_ENCONTRADO: misma respuesta, deliberadamente
    // indistinguible desde afuera (mismo criterio que recibir/route.ts).
    return NextResponse.json({ error: 'No autorizado para reportar este paquete.' }, { status: 403 });
  }

  // Misma respuesta mínima tanto para un reporte nuevo como para uno
  // duplicado — nunca se distingue desde afuera si fue la primera vez o
  // un reintento (mismo criterio que cofre-tracking, Fase 5.2).
  return NextResponse.json({ recibido: true }, { status: resultadoDelegacion.duplicado ? 200 : 201 });
}
