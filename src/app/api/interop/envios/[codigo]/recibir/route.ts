// src/app/api/interop/envios/[codigo]/recibir/route.ts
// Fase 4.4: primera operación de ESCRITURA real entre instalaciones. Este
// endpoint corre en la instalación de ORIGEN — la sucursal DESTINO le pide
// (autenticado por HMAC) que ejecute la recepción sobre SU PROPIO Envio.
// Regla fundamental (ver auditoría de Fase 4): ninguna sucursal escribe
// directamente en la base de otra — el destino solicita, el origen decide
// y ejecuta en su propia base.
//
// Qué SÍ hace: valida HMAC, identifica al solicitante, exige {qrToken} en
// el body (nunca en query string ni headers), valida destino+qrToken+
// estado, y si todo es correcto ejecuta recibirEnvio() (src/lib/envios.ts,
// sin duplicar su lógica) para pasar Envio.estado a RECIBIDO.
//
// Qué NO hace (deliberadamente, responsabilidad del DESTINO): no crea
// Package aquí, no cambia Package.status, no crea EnvioRecepcionRemota —
// eso vive en materializarRecepcionRemota() (src/lib/interop-envios.ts),
// que corre en el servidor de la sucursal DESTINO después de recibir la
// respuesta exitosa de este endpoint.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verificarRequestInteropNext } from '@/lib/interop/adaptador-next';
import { resolverApiKeyEntrante, recibirEnvioParaInterop } from '@/lib/interop-envios';

export const runtime = 'nodejs';

// Único campo aceptado, y ÚNICAMENTE desde el body JSON — nunca desde
// query string ni headers (instrucción explícita de esta fase).
const bodySchema = z.object({ qrToken: z.string().trim().min(1) });

export async function POST(req: NextRequest, { params }: { params: { codigo: string } }) {
  const { resultado, body } = await verificarRequestInteropNext(req, { resolverSecreto: resolverApiKeyEntrante });

  if (!resultado.ok) {
    // Mismo criterio que el GET de Fase 4.3: un único mensaje/código para
    // los 4 motivos posibles de fallo de autenticación — nunca se revela
    // hacia afuera cuál falló.
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
    return NextResponse.json({ error: 'Falta el qrToken en el cuerpo de la solicitud.' }, { status: 400 });
  }

  const recepcion = await recibirEnvioParaInterop(params.codigo, resultado.sucursalCodigo, parsed.data.qrToken);

  if (!recepcion.ok) {
    if (recepcion.motivo === 'NO_ENCONTRADO') {
      return NextResponse.json({ error: 'No se encontró ningún envío con ese código.' }, { status: 404 });
    }
    if (recepcion.motivo === 'ESTADO_INVALIDO') {
      return NextResponse.json({ error: 'Este envío no está en un estado que pueda recibirse.' }, { status: 409 });
    }
    if (recepcion.motivo === 'YA_RECIBIDO_LOCALMENTE') {
      // Distinto de ESTADO_INVALIDO a propósito: en este punto ya se
      // verificó HMAC+destino+qrToken correctos, así que decirle al
      // solicitante (ya demostrado legítimo) que este envío se recibió
      // por otra vía en el origen es información operativa útil, no una
      // fuga de seguridad — ver recibirEnvioParaInterop().
      return NextResponse.json({ error: 'Este envío ya fue recibido localmente en la instalación de origen.' }, { status: 409 });
    }
    // NO_ES_DESTINO y QR_INVALIDO: misma respuesta, deliberadamente
    // indistinguible desde afuera (ver recibirEnvioParaInterop() y
    // README.md) — nunca se revela cuál de los dos ocurrió, ni si el
    // token era parcialmente correcto o pertenece a otro lote.
    return NextResponse.json({ error: 'No autorizado para recibir este envío.' }, { status: 403 });
  }

  return NextResponse.json(recepcion.dto);
}
