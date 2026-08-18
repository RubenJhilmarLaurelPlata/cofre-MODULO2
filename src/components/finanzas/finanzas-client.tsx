'use client';

// src/components/finanzas/finanzas-client.tsx
import * as React from 'react';
import { LayoutGrid, Receipt, Lock, PenSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ResumenTab } from '@/components/finanzas/resumen-tab';
import { GastosTab } from '@/components/finanzas/gastos-tab';
import { CierreCajaTab } from '@/components/finanzas/cierre-caja-tab';
import { CorregirCobroTab } from '@/components/finanzas/corregir-cobro-tab';

type TabId = 'resumen' | 'gastos' | 'cierre' | 'corregir';

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutGrid }> = [
  { id: 'resumen', label: 'Resumen', icon: LayoutGrid },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'cierre', label: 'Cierre de caja', icon: Lock },
  { id: 'corregir', label: 'Corregir cobro', icon: PenSquare },
];

export function FinanzasClient({ moneda }: { moneda: string }) {
  const [tab, setTab] = React.useState<TabId>('resumen');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab moneda={moneda} />}
      {tab === 'gastos' && <GastosTab moneda={moneda} />}
      {tab === 'cierre' && <CierreCajaTab moneda={moneda} />}
      {tab === 'corregir' && <CorregirCobroTab />}
    </div>
  );
}
