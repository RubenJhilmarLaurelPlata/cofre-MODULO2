// src/app/api/interop/envios/[codigo]/route.ts
// Fase 4.3: primer endpoint REAL de interoperabilidad entre
// instalaciones — SOLO LECTURA. Autenticado por HMAC (ver
// src/lib/interop/), nunca por la cookie de sesión de un usuario humano
// (por eso src/middleware.ts excluye explícitamente "/api/interop" de su
// chequeo de sesión — este endpoint lo llama OTRA INSTALACIÓN, que nunca
// tiene esa cookie).
//
// Qué SÍ hace: busca el Envio local por código, valida que quien
// pregunta (ya autenticado) sea realmente la sucursal destino de ese
// envío, y devuelve un DTO limitado (ver src/lib/interop/dto.ts — nunca
// el objeto Prisma ni el DTO pensado para el frontend local).
//
// Qué NO hace (deliberadamente, fases futuras): no crea Package aquí, no
// cambia Package.status, no cambia Envio.estado, no crea
// EnvioRecepcionRemota, no implementa POST /recibir.
import { NextRequest, NextResponse } from 'next/server';
import { verificarRequestInteropNext } from '@/lib/interop/adaptador-next';
import { resolverApiKeyEntrante, getEnvioParaInterop } from '@/lib/interop-envios';

// node:crypto (usado por src/lib/interop/) requiere el runtime Node, no Edge — mismo criterio ya usado en src/app/api/importacion/route.ts.
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { codigo: string } }) {
  const { resultado } = await verificarRequestInteropNext(req, { resolverSecreto: resolverApiKeyEntrante });

  if (!resultado.ok) {
    // Deliberadamente el mismo mensaje/código para los 4 motivos posibles
    // (sucursal desconocida, timestamp inválido, nonce inválido/repetido,
    // firma inválida) — internamente sí se distinguen (ver
    // verificarFirmaInterop), pero nunca hacia afuera: no le regalamos a
    // quien ataca información sobre CUÁL parte de su intento falló.
    return NextResponse.json({ error: 'Autenticación inválida.' }, { status: 401 });
  }

  const consulta = await getEnvioParaInterop(params.codigo, resultado.sucursalCodigo);

  if (!consulta.ok) {
    if (consulta.motivo === 'NO_ES_DESTINO') {
      return NextResponse.json({ error: 'Esta sucursal no está autorizada para consultar este envío.' }, { status: 403 });
    }
    return NextResponse.json({ error: 'No se encontró ningún envío con ese código.' }, { status: 404 });
  }

  return NextResponse.json(consulta.dto);
}
