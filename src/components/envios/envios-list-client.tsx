'use client';

// src/components/envios/envios-list-client.tsx
import * as React from 'react';
import Link from 'next/link';
import { Send, Plus, RefreshCw, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EnvioDTO {
  id: string;
  codigo: string;
  estado: string;
  destino: { id: string; codigo: string; nombre: string; ciudad: string | null };
  cantidadPaquetes: number;
  creadoPor: string | null;
  cerradoPor: string | null;
  createdAt: string;
  cerradoAt: string | null;
}

const ESTADO_BADGE: Record<string, { label: string; variant: 'brand' | 'success' | 'neutral' }> = {
  BORRADOR: { label: 'Borrador', variant: 'brand' },
  CERRADO: { label: 'Cerrado', variant: 'success' },
  CANCELADO: { label: 'Cancelado', variant: 'neutral' },
};

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function EnviosListClient() {
  const [envios, setEnvios] = React.useState<EnvioDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [q, setQ] = React.useState('');
  const [estadoFiltro, setEstadoFiltro] = React.useState('');

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (estadoFiltro) params.set('estado', estadoFiltro);
      const res = await fetch(`/api/envios?${params.toString()}`);
      if (res.ok) setEnvios(await res.json());
    } finally {
      setCargando(false);
    }
  }, [q, estadoFiltro]);

  React.useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-brand-500" /> Envíos
            </CardTitle>
            <Link href="/envios/nuevo">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" /> Nuevo envío
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código…" className="pl-9" />
            </div>
            <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
              {[
                { id: '', label: 'Todos' },
                { id: 'BORRADOR', label: 'Borrador' },
                { id: 'CERRADO', label: 'Cerrado' },
                { id: 'CANCELADO', label: 'Cancelado' },
              ].map((op) => (
                <button
                  key={op.id}
                  onClick={() => setEstadoFiltro(op.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    estadoFiltro === op.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={cargar} loading={cargando}>
              <RefreshCw className="h-3.5 w-3.5" /> Actualizar
            </Button>
          </div>

          {cargando ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
          ) : envios.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay envíos que coincidan con la búsqueda.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {envios.map((e) => {
                const badge = ESTADO_BADGE[e.estado] ?? { label: e.estado, variant: 'neutral' as const };
                return (
                  <Link
                    key={e.id}
                    href={`/envios/${e.id}`}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 -mx-2 px-2 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-ink dark:text-gray-100">{e.codigo}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                        Destino: {e.destino.nombre} · {e.cantidadPaquetes} paquete{e.cantidadPaquetes === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
                      <p>Creado {fmtFecha(e.createdAt)}</p>
                      {e.cerradoAt && <p>Cerrado {fmtFecha(e.cerradoAt)}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
