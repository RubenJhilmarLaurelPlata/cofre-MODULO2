// src/app/api/dashboard/clima/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { getClimaActual } from '@/lib/clima';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const company = await getCompanyConfig();
  if (company.climaLat === null || company.climaLon === null) {
    return NextResponse.json({ configurado: false, clima: null });
  }

  const clima = await getClimaActual(company.climaLat, company.climaLon);
  return NextResponse.json({ configurado: true, clima });
}
