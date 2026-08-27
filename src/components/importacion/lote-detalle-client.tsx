'use client';

// src/components/importacion/lote-detalle-client.tsx
// Detalle de un lote de importación: filtros por estado y búsqueda por
// código o persona, paginado en el servidor (nunca carga miles de filas
// de una sola vez — ver src/app/api/importacion/[id]/route.ts).
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Fila {
  id: string;
  numeroFila: number;
  codigo: string;
  codigoOficial: string | null;
  monto: number | null;
  persona: string | null;
  estado: string;
  motivo: string | null;
}

interface Lote {
  id: string;
  nombreArchivo: string;
  nombreLote: string | null;
  formato: string;
  tipoImportacion: string;
  detectados: number;
  validos: number;
  duplicados: number;
  invalidos: number;
  marcadosEntregado: number;
  noEncontrados: number;
  creadosFaltantes: number;
  usuario: string;
  createdAt: string;
}

const ESTADO_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'brand' }> = {
  ENTREGADO: { label: 'Entregado', variant: 'success' },
  CREADO: { label: 'Creado', variant: 'brand' },
  EN_DEPOSITO: { label: 'En depósito', variant: 'brand' },
  SOLO_DATOS: { label: 'Solo datos', variant: 'neutral' },
  YA_ENTREGADO: { label: 'Ya existía', variant: 'neutral' },
  DUPLICADO: { label: 'Duplicado', variant: 'warning' },
  NO_ENCONTRADO: { label: 'No encontrado', variant: 'warning' },
  INVALIDO: { label: 'Inválido', variant: 'danger' },
  ERROR: { label: 'Error', variant: 'danger' },
};

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function LoteDetalleClient({ loteId }: { loteId: string }) {
  const [lote, setLote] = React.useState<Lote | null>(null);
  const [conteoPorEstado, setConteoPorEstado] = React.useState<Record<string, number>>({});
  const [filas, setFilas] = React.useState<Fila[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPaginas, setTotalPaginas] = React.useState(1);
  const [pagina, setPagina] = React.useState(1);
  const [estadoFiltro, setEstadoFiltro] = React.useState<string | null>(null);
  const [buscar, setBuscar] = React.useState('');
  const [buscarDebounced, setBuscarDebounced] = React.useState('');
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setBuscarDebounced(buscar.trim()), 300);
    return () => clearTimeout(t);
  }, [buscar]);

  React.useEffect(() => {
    setPagina(1);
  }, [estadoFiltro, buscarDebounced]);

  React.useEffect(() => {
    setCargando(true);
    setError(null);
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (estadoFiltro) params.set('estado', estadoFiltro);
    if (buscarDebounced) params.set('buscar', buscarDebounced);
    fetch(`/api/importacion/${loteId}?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar el lote.');
        return data;
      })
      .then((data) => {
        setLote(data.lote);
        setConteoPorEstado(data.conteoPorEstado);
        setFilas(data.filas);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [loteId, pagina, estadoFiltro, buscarDebounced]);

  const totalFilasLote = Object.values(conteoPorEstado).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <Link href="/importacion" className="inline-flex items-center gap-1.5 text-sm text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Volver a Importación
      </Link>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {lote && (
        <Card>
          <CardHeader>
            <CardTitle>{lote.nombreLote ?? lote.nombreArchivo}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-soft dark:text-gray-400">
            <p>
              {lote.nombreArchivo} ({lote.formato}) · {fmtFechaHora(lote.createdAt)} · {lote.usuario}
            </p>
            <p>
              {lote.detectados} registros detectados · {lote.marcadosEntregado} entregados · {lote.creadosFaltantes} creados
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detalle por fila</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEstadoFiltro(null)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium',
                estadoFiltro === null ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400' : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400'
              )}
            >
              Todos ({totalFilasLote})
            </button>
            {Object.entries(conteoPorEstado).map(([estado, cantidad]) => (
              <button
                key={estado}
                type="button"
                onClick={() => setEstadoFiltro(estado)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium',
                  estadoFiltro === estado ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400' : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400'
                )}
              >
                {(ESTADO_LABEL[estado]?.label ?? estado)} ({cantidad})
              </button>
            ))}
          </div>

          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300 dark:text-gray-600" />
            <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por código o persona…" className="pl-9" />
          </div>

          {cargando ? (
            <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filas.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay filas que coincidan.</p>
          ) : (
            <>
              {/* Móvil: tarjetas */}
              <div className="space-y-2 md:hidden">
                {filas.map((f) => (
                  <div key={f.id} className="rounded-lg border border-gray-100 dark:border-gray-800/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-ink dark:text-gray-100">{f.codigoOficial ?? f.codigo}</span>
                      <Badge variant={ESTADO_LABEL[f.estado]?.variant ?? 'neutral'}>{ESTADO_LABEL[f.estado]?.label ?? f.estado}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft dark:text-gray-400">
                      {f.monto !== null && <span>Bs {f.monto}</span>}
                      {f.persona && <span>{f.persona}</span>}
                      <span>Fila {f.numeroFila}</span>
                    </div>
                    {f.motivo && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{f.motivo}</p>}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800/60 text-left text-xs text-gray-400 dark:text-gray-500">
                      <th className="pb-2 font-medium">Fila</th>
                      <th className="pb-2 font-medium">Código</th>
                      <th className="pb-2 font-medium">Monto</th>
                      <th className="pb-2 font-medium">Persona</th>
                      <th className="pb-2 font-medium">Estado</th>
                      <th className="pb-2 font-medium">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filas.map((f) => (
                      <tr key={f.id}>
                        <td className="py-1.5 text-gray-400 dark:text-gray-500">{f.numeroFila}</td>
                        <td className="py-1.5 font-mono text-ink dark:text-gray-100">{f.codigoOficial ?? f.codigo}</td>
                        <td className="py-1.5 text-ink-soft dark:text-gray-400">{f.monto !== null ? `Bs ${f.monto}` : '—'}</td>
                        <td className="py-1.5 text-ink-soft dark:text-gray-400">{f.persona ?? '—'}</td>
                        <td className="py-1.5">
                          <Badge variant={ESTADO_LABEL[f.estado]?.variant ?? 'neutral'}>{ESTADO_LABEL[f.estado]?.label ?? f.estado}</Badge>
                        </td>
                        <td className="py-1.5 text-xs text-gray-400 dark:text-gray-500">{f.motivo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPaginas > 1 && (
                <div className="flex items-center justify-between pt-2 text-xs text-gray-400 dark:text-gray-500">
                  <span>
                    Página {pagina} de {totalPaginas} · {total} fila(s)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1}>
                      Anterior
                    </Button>
                    <Button variant="secondary" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas}>
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
