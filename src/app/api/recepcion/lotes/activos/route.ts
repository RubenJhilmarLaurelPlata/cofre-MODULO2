// src/app/api/recepcion/lotes/activos/route.ts
// Fase 4B: alimenta el panel "Lote activo" de Recepcion. Visible para
// cualquiera con acceso a Recepcion (no solo Admin — un operador tambien
// necesita ver cuanto queda del lote, aunque solo Admin pueda CREAR uno
// nuevo, ver POST /api/codigos-personalizados).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getLotesActivos } from '@/lib/etiquetas';

export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'recepcion.ver'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const lotes = await getLotesActivos();
  return NextResponse.json({ lotes });
}
