// src/app/page.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { moduloInicialPara } from '@/types';

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  redirect(`/${moduloInicialPara(session.role) ?? 'login'}`);
}
