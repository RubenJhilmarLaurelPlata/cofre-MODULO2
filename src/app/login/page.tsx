// src/app/login/page.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { moduloInicialPara } from '@/types';
import { Logo } from '@/components/layout/logo';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(`/${moduloInicialPara(session.role) ?? 'login'}`);
  const company = await getCompanyConfig();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-800/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo logoUrl={company.logoUrl} size={64} className="ring-0" />
          <div className="text-center">
            <p className="text-lg font-semibold leading-tight text-ink dark:text-gray-100">Cofre Express</p>
            <p className="text-sm text-ink-soft dark:text-gray-400">Ingresa a tu cuenta</p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-card">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          Cofre Express © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
