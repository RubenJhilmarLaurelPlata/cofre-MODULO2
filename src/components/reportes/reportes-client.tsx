'use client';

// src/components/reportes/reportes-client.tsx
import * as React from 'react';
import { Boxes, Wallet, Users, Archive, Tags, History, Search, Printer, FileText, FileSpreadsheet, FileType, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ESTADO_LABELS } from '@/components/ui/status-badge';
import { ReportView } from '@/components/reportes/report-view';
import { HistorialReportesTab } from '@/components/reportes/historial-reportes-tab';
import { PACKAGE_STATUSES, type PackageStatus } from '@/types';

interface UsuarioFiltro {
  id: string;
  nombre: string;
  role: string;
}

interface SerieFiltro {
  inicial: string;
  descripcion: string;
}

interface ReportesClientProps {
  usuarios: UsuarioFiltro[];
  series: SerieFiltro[];
}

type ModoFecha = 'hoy' | 'ayer' | 'semana' | 'mes' | 'especifica' | 'rango';
type TabId = 'PAQUETES' | 'FINANCIERO' | 'OPERADORES' | 'DEPOSITO' | 'ETIQUETAS' | 'HISTORIAL';

interface Filtros {
  modo: ModoFecha;
  fecha: string;
  fechaInicio: string;
  fechaFin: string;
  estado: PackageStatus | '';
  usuarioId: string;
  inicial: string;
  q: string;
}

function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MODOS: Array<{ id: ModoFecha; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'especifica', label: 'Fecha específica' },
  { id: 'rango', label: 'Rango de fechas' },
];

const TABS: Array<{ id: TabId; label: string; icon: typeof Boxes; endpoint: string | null }> = [
  { id: 'PAQUETES', label: 'Paquetes', icon: Boxes, endpoint: '/api/reportes/paquetes' },
  { id: 'FINANCIERO', label: 'Financiero', icon: Wallet, endpoint: '/api/reportes/financiero' },
  { id: 'OPERADORES', label: 'Operadores', icon: Users, endpoint: '/api/reportes/operadores' },
  { id: 'DEPOSITO', label: 'Depósito', icon: Archive, endpoint: '/api/reportes/deposito' },
  { id: 'ETIQUETAS', label: 'Etiquetas', icon: Tags, endpoint: '/api/reportes/etiquetas' },
  { id: 'HISTORIAL', label: 'Historial', icon: History, endpoint: null },
];

function filtrosAPayload(f: Filtros): Record<string, string> {
  const payload: Record<string, string> = { modo: f.modo };
  if (f.modo === 'especifica') payload.fecha = f.fecha;
  if (f.modo === 'rango') {
    payload.fechaInicio = f.fechaInicio;
    payload.fechaFin = f.fechaFin;
  }
  if (f.estado) payload.estado = f.estado;
  if (f.usuarioId) payload.usuarioId = f.usuarioId;
  if (f.inicial) payload.inicial = f.inicial;
  if (f.q.trim()) payload.q = f.q.trim();
  return payload;
}

export function ReportesClient({ usuarios, series }: ReportesClientProps) {
  const [tab, setTab] = React.useState<TabId>('PAQUETES');
  const [filtros, setFiltros] = React.useState<Filtros>({
    modo: 'hoy',
    fecha: hoyStr(),
    fechaInicio: hoyStr(),
    fechaFin: hoyStr(),
    estado: '',
    usuarioId: '',
    inicial: '',
    q: '',
  });
  const [exportando, setExportando] = React.useState<'PDF' | 'EXCEL' | 'CSV' | null>(null);
  const [errorExport, setErrorExport] = React.useState<string | null>(null);

  const queryString = React.useMemo(() => new URLSearchParams(filtrosAPayload(filtros)).toString(), [filtros]);

  async function exportar(formato: 'PDF' | 'EXCEL' | 'CSV') {
    if (tab === 'HISTORIAL' || exportando) return;
    setExportando(formato);
    setErrorExport(null);
    try {
      const res = await fetch('/api/reportes/exportar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tab, formato, filtros: filtrosAPayload(filtros) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorExport(data?.error ?? 'No se pudo exportar el reporte.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = formato === 'PDF' ? 'pdf' : formato === 'EXCEL' ? 'xlsx' : 'csv';
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte-${tab.toLowerCase()}-${hoyStr()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrorExport('Error de conexión al exportar. Intenta de nuevo.');
    } finally {
      setExportando(null);
    }
  }

  const tabActiva = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-5">
      <Card className="print:hidden">
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Período</label>
            <div className="flex flex-wrap gap-2">
              {MODOS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setFiltros((f) => ({ ...f, modo: m.id }))}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    filtros.modo === m.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700' : 'border-gray-200 dark:border-gray-800 text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {filtros.modo === 'especifica' && (
            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Fecha</label>
              <Input type="date" value={filtros.fecha} onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))} />
            </div>
          )}
          {filtros.modo === 'rango' && (
            <div className="grid max-w-md grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Desde</label>
                <Input type="date" value={filtros.fechaInicio} onChange={(e) => setFiltros((f) => ({ ...f, fechaInicio: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Hasta</label>
                <Input
                  type="date"
                  value={filtros.fechaFin}
                  onChange={(e) => setFiltros((f) => ({ ...f, fechaFin: e.target.value }))}
                  min={filtros.fechaInicio}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Estado</label>
              <select
                value={filtros.estado}
                onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value as PackageStatus | '' }))}
                className="h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Todos los estados</option>
                {PACKAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ESTADO_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Usuario / Operador</label>
              <select
                value={filtros.usuarioId}
                onChange={(e) => setFiltros((f) => ({ ...f, usuarioId: e.target.value }))}
                className="h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Todos los usuarios</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Tipo (inicial)</label>
              <select
                value={filtros.inicial}
                onChange={(e) => setFiltros((f) => ({ ...f, inicial: e.target.value }))}
                className="h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Todos los tipos</option>
                {series.map((s) => (
                  <option key={s.inicial} value={s.inicial}>
                    {s.inicial} — {s.descripcion}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">Buscar</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                <Input
                  value={filtros.q}
                  onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Código, remitente, destinatario, teléfono, observaciones, usuario…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                tab === t.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
              )}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab !== 'HISTORIAL' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => exportar('PDF')} loading={exportando === 'PDF'}>
              <FileType className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportar('EXCEL')} loading={exportando === 'EXCEL'}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportar('CSV')} loading={exportando === 'CSV'}>
              <FileText className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Button>
          </div>
        )}
      </div>

      {errorExport && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400 print:hidden">
          <XCircle className="h-4 w-4 shrink-0" /> {errorExport}
        </div>
      )}

      {tab === 'HISTORIAL' ? (
        <HistorialReportesTab />
      ) : (
        <ReportView endpoint={tabActiva.endpoint!} queryString={queryString} icon={tabActiva.icon} />
      )}
    </div>
  );
}
