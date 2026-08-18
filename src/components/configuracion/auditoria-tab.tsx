'use client';

// src/components/configuracion/auditoria-tab.tsx
import * as React from 'react';
import { Search, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface AuditLogDTO {
  id: string;
  usuario: string;
  ip: string | null;
  userAgent: string | null;
  accion: string;
  modulo: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  createdAt: string;
}

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(iso)
  );
}

function resumirValor(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    const texto = JSON.stringify(v);
    return texto.length > 80 ? `${texto.slice(0, 79)}…` : texto;
  } catch {
    return String(v);
  }
}

export function AuditoriaTab() {
  const [logs, setLogs] = React.useState<AuditLogDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [q, setQ] = React.useState('');
  const [modulo, setModulo] = React.useState('');
  const [desde, setDesde] = React.useState('');
  const [hasta, setHasta] = React.useState('');

  const buscar = React.useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (modulo) params.set('modulo', modulo);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const res = await fetch(`/api/configuracion/auditoria?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cargar la auditoría.');
        return;
      }
      setLogs(data);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [q, modulo, desde, hasta]);

  React.useEffect(() => {
    const t = setTimeout(buscar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, modulo, desde, hasta]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Auditoría</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Acción, usuario, valores…" className="pl-9" />
            </div>
            <select
              value={modulo}
              onChange={(e) => setModulo(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Todos los módulos</option>
              <option value="auth">Autenticación</option>
              <option value="recepcion">Recepción</option>
              <option value="paquetes">Paquetes</option>
              <option value="etiquetas">Etiquetas</option>
              <option value="reportes">Reportes</option>
              <option value="usuarios">Usuarios</option>
              <option value="configuracion">Configuración</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {cargando ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No se encontró ningún registro con esos filtros.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800/60">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Fecha</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Usuario</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Módulo</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Acción</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Valor anterior</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Valor nuevo</th>
                    <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft dark:text-gray-400">{fmtFechaHora(l.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink dark:text-gray-100">{l.usuario}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-soft dark:text-gray-400">{l.modulo}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink dark:text-gray-100">{l.accion}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{resumirValor(l.valorAnterior)}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{resumirValor(l.valorNuevo)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{l.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
