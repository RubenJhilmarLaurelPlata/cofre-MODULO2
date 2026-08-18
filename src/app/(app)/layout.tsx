// src/app/(app)/layout.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { SoundPreferenceSync } from '@/components/layout/sound-preference-sync';
import { AudioUnlock } from '@/components/layout/audio-unlock';
import { ScannerBootstrap } from '@/components/layout/scanner-bootstrap';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const company = await getCompanyConfig();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 print:h-auto print:overflow-visible dark:bg-gray-950">
      <SoundPreferenceSync sonidosActivos={company.sonidosActivos} />
      <AudioUnlock />
      <ScannerBootstrap
        habilitado={company.s700Habilitado}
        appId={company.s700AppId}
        developerId={company.s700DeveloperId}
        appKey={company.s700AppKey}
      />
      <Sidebar role={session.role} logoUrl={company.logoUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar nombre={session.nombre} role={session.role} logoUrl={company.logoUrl} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
