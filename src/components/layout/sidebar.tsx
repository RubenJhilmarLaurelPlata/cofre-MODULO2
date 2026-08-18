'use client';

// src/components/layout/sidebar.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { puedeAcceder, ROLE_LABELS, type Role } from '@/types';
import { NAV_ITEMS, NAV_GRUPO_LABELS } from '@/lib/nav-items';
import { Logo } from '@/components/layout/logo';

export function Sidebar({ role, logoUrl }: { role: Role; logoUrl?: string | null }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => puedeAcceder(role, item.modulo));
  const grupos = Array.from(new Set(items.map((i) => i.grupo)));

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-navy-900 md:flex print:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo logoUrl={logoUrl} size={32} />
        <span className="text-sm font-semibold text-white">Cofre Express</span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {grupos.map((grupo) => (
          <div key={grupo} className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-100/35">{NAV_GRUPO_LABELS[grupo]}</p>
            {items
              .filter((item) => item.grupo === grupo)
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex items-center gap-3 rounded-lg py-2 pl-3.5 pr-3 text-sm font-medium transition-colors',
                      active ? 'bg-white/[0.07] text-white' : 'text-navy-100/70 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brand-500" />}
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                    {item.label}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3.5 text-[11px] text-navy-100/40">
        <span>{ROLE_LABELS[role]}</span>
        <span>Cofre Express · v3.0</span>
      </div>
    </aside>
  );
}
