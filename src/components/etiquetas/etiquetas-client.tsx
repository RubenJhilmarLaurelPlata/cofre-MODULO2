'use client';

// src/components/etiquetas/etiquetas-client.tsx
import * as React from 'react';
import { Tags, Printer, History, Sparkles, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GenerarPdfTab } from '@/components/etiquetas/generar-pdf-tab';
import { GenerarTab, type SerieInfo, type PrefillDuplicado } from '@/components/etiquetas/generar-tab';
import { PersonalizadosTab } from '@/components/etiquetas/personalizados-tab';
import { ReimprimirTab } from '@/components/etiquetas/reimprimir-tab';
import { HistorialTab } from '@/components/etiquetas/historial-tab';

interface EtiquetasClientProps {
  esAdmin: boolean;
  seriesIniciales: SerieInfo[];
  monthLettersIniciales: Record<number, string>;
  separadorDefault: string;
}

type Tab = 'generar-pdf' | 'generar' | 'personalizados' | 'reimprimir' | 'historial';

export function EtiquetasClient({ esAdmin, seriesIniciales, monthLettersIniciales, separadorDefault }: EtiquetasClientProps) {
  const [tab, setTab] = React.useState<Tab>(esAdmin ? 'generar-pdf' : 'reimprimir');
  const [series, setSeries] = React.useState<SerieInfo[]>(seriesIniciales);
  const [monthLetters, setMonthLetters] = React.useState<Record<number, string>>(monthLettersIniciales);
  const [prefillDuplicado, setPrefillDuplicado] = React.useState<PrefillDuplicado | null>(null);

  function actualizarCorrelativo(inicial: string, nuevoCorrelativo: number) {
    setSeries((prev) => {
      const existe = prev.some((s) => s.inicial === inicial);
      if (!existe) return [...prev, { inicial, descripcion: `Serie ${inicial}`, correlativo: nuevoCorrelativo }].sort((a, b) => a.inicial.localeCompare(b.inicial));
      return prev.map((s) => (s.inicial === inicial ? { ...s, correlativo: Math.max(s.correlativo, nuevoCorrelativo) } : s));
    });
  }

  function duplicarLote(prefill: PrefillDuplicado) {
    setPrefillDuplicado(prefill);
    setTab('generar');
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Tags }> = esAdmin
    ? [
        { id: 'generar-pdf', label: 'Generar PDF', icon: FileText },
        { id: 'generar', label: 'Avanzado', icon: Tags },
        { id: 'personalizados', label: 'Personalizados', icon: Sparkles },
        { id: 'reimprimir', label: 'Reimprimir', icon: Printer },
        { id: 'historial', label: 'Historial', icon: History },
      ]
    : [
        { id: 'reimprimir', label: 'Reimprimir', icon: Printer },
        { id: 'historial', label: 'Historial', icon: History },
      ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 sm:inline-flex">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              tab === t.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'generar-pdf' && esAdmin && (
        <GenerarPdfTab
          series={series}
          monthLetters={monthLetters}
          separadorDefault={separadorDefault}
          onCorrelativoActualizado={actualizarCorrelativo}
        />
      )}
      {tab === 'generar' && esAdmin && (
        <GenerarTab
          series={series}
          monthLetters={monthLetters}
          separadorDefault={separadorDefault}
          prefill={prefillDuplicado}
          onPrefillConsumido={() => setPrefillDuplicado(null)}
          onCorrelativoActualizado={actualizarCorrelativo}
          onMonthLettersGuardadas={setMonthLetters}
        />
      )}
      {tab === 'personalizados' && esAdmin && <PersonalizadosTab separadorDefault={separadorDefault} />}
      {tab === 'reimprimir' && <ReimprimirTab />}
      {tab === 'historial' && <HistorialTab esAdmin={esAdmin} series={series} onDuplicar={duplicarLote} />}
    </div>
  );
}
