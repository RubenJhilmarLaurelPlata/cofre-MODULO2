// src/app/api/finanzas/cierres/route.ts
// Solo lectura del historial de cierres (usado por CierreCajaTab). El
// POST que existia aqui permitia crear un CierreCaja "huerfano" sobre un
// rango de fechas arbitrario, sin pasar por ninguna CajaSesion — el
// frontend nunca lo llamaba (confirmado: solo hace fetch GET a esta
// ruta), asi que se elimino: la UNICA forma de crear un CierreCaja ahora
// es cerrarCajaSesion() (ver /api/finanzas/caja/cerrar), que siempre
// esta atada a una sesion real. Ver auditoria del modulo de Caja.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { listarCierresCaja } from '@/lib/finanzas';


export async function GET() {
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'finanzas.ver_caja'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await listarCierresCaja());
}
