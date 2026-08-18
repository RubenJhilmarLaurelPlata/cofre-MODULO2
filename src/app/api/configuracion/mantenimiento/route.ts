// src/app/api/configuracion/mantenimiento/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getInfoMantenimiento } from '@/lib/mantenimiento';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  return NextResponse.json(await getInfoMantenimiento());
}
