// src/app/api/auth/logout/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/auth';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session) {
    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({ userId: session.id, accion: 'LOGOUT', modulo: 'auth', ip, userAgent });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
