// src/app/api/configuracion/respaldos/oracle/restaurar/route.ts
// Restaurar desde un respaldo real de Oracle Object Storage — ADMIN
// unicamente, requiere confirmacion explicita en el cliente
// (window.confirm) antes de llegar aca. Ver restaurarDesdeOracle() en
// src/lib/backup-oracle.ts para las verificaciones de seguridad
// (integrity_check antes de tocar nada, copia de seguridad del archivo
// actual, nunca reinicia el proceso por su cuenta).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { restaurarDesdeOracle } from '@/lib/backup-oracle';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

const bodySchema = z.object({ nombreArchivo: z.string().trim().min(1).max(300) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Indica qué respaldo restaurar.' }, { status: 400 });
  }

  const resultado = await restaurarDesdeOracle(parsed.data.nombreArchivo);

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: resultado.ok ? 'RESPALDO_ORACLE_RESTAURADO' : 'RESPALDO_ORACLE_ERROR',
    modulo: 'configuracion',
    valorNuevo: { nombreArchivo: parsed.data.nombreArchivo, ok: resultado.ok, error: resultado.error },
    ip,
    userAgent,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error ?? 'No se pudo restaurar el respaldo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mensaje: resultado.mensaje });
}
