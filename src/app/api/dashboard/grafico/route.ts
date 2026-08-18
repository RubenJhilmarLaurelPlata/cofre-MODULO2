// src/app/api/dashboard/grafico/route.ts
// Serie diaria de ingresados/entregados para el selector de periodo real
// del Dashboard (Fase 4A: 7/30/90/365 dias o un rango personalizado).
// Reutiliza calcularSerieDiaria() — la misma funcion que arma "ultimos7"
// en la carga inicial del Dashboard (src/lib/dashboard-data.ts), nunca
// una segunda forma de calcular lo mismo. Una sola consulta con select
// acotado a las dos columnas de fecha, igual criterio de rendimiento que
// el resto del Dashboard.
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { calcularSerieDiaria, startOfDay, addDays } from '@/lib/dashboard-data';

const MAX_DIAS = 400;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const url = req.nextUrl;
  const diasParam = url.searchParams.get('dias');
  const desdeParam = url.searchParams.get('desde');
  const hastaParam = url.searchParams.get('hasta');

  const hoy = startOfDay(new Date());
  const manana = addDays(hoy, 1);

  let desde: Date;
  let diasCount: number;

  if (desdeParam && hastaParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeParam) || !/^\d{4}-\d{2}-\d{2}$/.test(hastaParam)) {
      return NextResponse.json({ error: 'Formato de fecha inválido (usa AAAA-MM-DD).' }, { status: 400 });
    }
    desde = startOfDay(new Date(`${desdeParam}T00:00:00`));
    const hasta = startOfDay(new Date(`${hastaParam}T00:00:00`));
    if (hasta < desde) {
      return NextResponse.json({ error: 'La fecha "hasta" no puede ser anterior a "desde".' }, { status: 400 });
    }
    diasCount = Math.round((hasta.getTime() - desde.getTime()) / 86_400_000) + 1;
  } else {
    const dias = Number(diasParam ?? '7');
    if (![7, 30, 90, 365].includes(dias)) {
      return NextResponse.json({ error: 'Periodo inválido. Usa 7, 30, 90, 365, o desde/hasta.' }, { status: 400 });
    }
    diasCount = dias;
    desde = addDays(hoy, -(dias - 1));
  }

  if (diasCount > MAX_DIAS) {
    return NextResponse.json({ error: `El rango no puede superar ${MAX_DIAS} días.` }, { status: 400 });
  }

  const finRango = addDays(desde, diasCount); // exclusivo
  const limite = finRango < manana ? finRango : manana;
  // OR (no solo ingresoAt): un paquete que ingreso antes del rango pero
  // se entrego dentro de el tambien debe contar como "entregado" ese
  // dia — filtrar solo por ingresoAt lo dejaba afuera.
  const paquetes = await prisma.package.findMany({
    where: { OR: [{ ingresoAt: { gte: desde, lt: limite } }, { entregaAt: { gte: desde, lt: limite } }] },
    select: { ingresoAt: true, entregaAt: true },
  });

  const serie = calcularSerieDiaria(paquetes, desde, diasCount);
  return NextResponse.json({ serie });
}
