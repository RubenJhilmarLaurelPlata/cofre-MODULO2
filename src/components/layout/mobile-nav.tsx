'use client';

// src/components/layout/mobile-nav.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { puedeAcceder, type Role } from '@/types';
import { NAV_ITEMS, NAV_GRUPO_LABELS } from '@/lib/nav-items';
import { Logo } from '@/components/layout/logo';

export function MobileNav({ role, logoUrl, open, onClose }: { role: Role; logoUrl?: string | null; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => puedeAcceder(role, item.modulo));
  const grupos = Array.from(new Set(items.map((i) => i.grupo)));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-navy-900 shadow-popover">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Logo logoUrl={logoUrl} size={28} />
            <span className="text-sm font-semibold text-white">Cofre Express</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar menú" className="flex h-11 w-11 items-center justify-center rounded-md text-navy-100/60 hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" />
          </button>
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
                      onClick={onClose}
                      className={cn(
                        'relative flex min-h-[44px] items-center gap-3 rounded-lg py-2.5 pl-3.5 pr-3 text-sm font-medium transition-colors',
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
      </div>
    </div>
  );
}
