// src/app/api/importacion/progreso/[jobId]/route.ts
// Progreso en vivo de una importación en curso, vía Server-Sent Events —
// el frontend abre este stream justo después de recibir el jobId de
// POST /api/importacion (accion=confirmar) y lo consume hasta el evento
// "done"/"error", en vez de esperar una única petición HTTP gigante
// abierta durante todo el proceso (ver comentario en
// src/app/api/importacion/route.ts, "No quiero errores 504 por diseño").
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { obtenerJob } from '@/lib/importacion-jobs';

export const runtime = 'nodejs';

const INTERVALO_MS = 400;

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return new Response('No tienes permiso para esta acción', { status: 403 });
  }

  const { jobId } = params;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let cerrado = false;

      function enviar(evento: string, data: unknown) {
        if (cerrado) return;
        controller.enqueue(encoder.encode(`event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      function cerrar() {
        if (cerrado) return;
        cerrado = true;
        clearInterval(intervalo);
        try {
          controller.close();
        } catch {
          // El stream ya pudo haber sido cerrado por el cliente — ignorar.
        }
      }

      const intervalo = setInterval(() => {
        const job = obtenerJob(jobId);
        if (!job) {
          // El job no existe (id inválido, o ya se limpió mucho después de
          // terminar) — se lo decimos al cliente una vez y cerramos, en
          // vez de dejar el stream abierto para siempre sin novedades.
          // "fallo" (no "error"): el evento nativo "error" de EventSource
          // ya está reservado para fallas de conexión — usar ese mismo
          // nombre para un evento de aplicación es ambiguo en el cliente
          // (a veces llega sin "data"). Ver importacion-client.tsx.
          enviar('fallo', { mensaje: 'No se encontró esta importación en curso (puede que el servidor se haya reiniciado).' });
          cerrar();
          return;
        }

        enviar('progress', {
          total: job.total,
          procesados: job.procesados,
          errores: job.errores,
          actual: job.actual,
          estado: job.estado,
        });

        if (job.estado === 'completado') {
          enviar('done', { resultado: job.resultado, importLogId: job.importLogId });
          cerrar();
        } else if (job.estado === 'error') {
          enviar('fallo', { mensaje: job.errorMensaje ?? 'Ocurrió un error al procesar la importación.' });
          cerrar();
        }
      }, INTERVALO_MS);

      req.signal.addEventListener('abort', cerrar);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
