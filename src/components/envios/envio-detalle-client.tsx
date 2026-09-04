'use client';

// src/components/envios/envio-detalle-client.tsx
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, ScanLine, Trash2, CheckCircle2, XCircle, Lock, Ban, RefreshCw, QrCode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { playSound } from '@/lib/sound';
import { cn } from '@/lib/utils';

interface EnvioItemDTO {
  id: string;
  packageId: string;
  code: string;
  status: string;
  ingresoAt: string;
  createdAt: string;
}
interface EnvioDetalleDTO {
  id: string;
  codigo: string;
  estado: string;
  destino: { id: string; codigo: string; nombre: string; ciudad: string | null };
  cantidadPaquetes: number;
  creadoPor: string | null;
  cerradoPor: string | null;
  createdAt: string;
  cerradoAt: string | null;
  qrToken: string | null;
  items: EnvioItemDTO[];
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

export function EnvioDetalleClient({ envioId }: { envioId: string }) {
  const [envio, setEnvio] = React.useState<EnvioDetalleDTO | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState('');
  const [ultimoScan, setUltimoScan] = React.useState<{ ok: boolean; code: string; mensaje: string } | null>(null);
  const [cerrando, setCerrando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [confirmarCierre, setConfirmarCierre] = React.useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const cargar = React.useCallback(async () => {
    const res = await fetch(`/api/envios/${envioId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'No se pudo cargar el envío.');
      return;
    }
    setEnvio(data);
  }, [envioId]);

  React.useEffect(() => {
    setCargando(true);
    cargar().finally(() => setCargando(false));
  }, [cargar]);

  async function procesarAgregar(code: string) {
    const res = await fetch(`/api/envios/${envioId}/paquetes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      setUltimoScan({ ok: false, code, mensaje: data.error ?? 'No se pudo agregar el paquete.' });
      playSound('error');
      return;
    }
    setEnvio(data);
    setUltimoScan({ ok: true, code, mensaje: 'Agregado al envío.' });
    playSound('ok');
  }

  const { encolar, procesando } = useScanQueue<string>({
    procesar: procesarAgregar,
    inputRef,
    debeEnfocar: () => envio?.estado === 'BORRADOR',
  });

  function agregar(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    setValor('');
    if (!code) return;
    encolar(code);
  }

  async function quitar(item: EnvioItemDTO) {
    const res = await fetch(`/api/envios/${envioId}/paquetes/${item.packageId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'No se pudo quitar el paquete.');
      return;
    }
    setEnvio(data);
  }

  async function cerrar() {
    setCerrando(true);
    setError(null);
    try {
      const res = await fetch(`/api/envios/${envioId}/cerrar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cerrar el envío.');
        return;
      }
      setEnvio(data);
      setConfirmarCierre(false);
    } finally {
      setCerrando(false);
    }
  }

  async function cancelar() {
    setCancelando(true);
    setError(null);
    try {
      const res = await fetch(`/api/envios/${envioId}/cancelar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cancelar el envío.');
        return;
      }
      setEnvio(data);
      setConfirmarCancelar(false);
    } finally {
      setCancelando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;
  if (!envio) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error ?? 'No se encontró el envío.'}</CardContent>
      </Card>
    );
  }

  const badge = ESTADO_BADGE[envio.estado] ?? { label: envio.estado, variant: 'neutral' as const };
  const esBorrador = envio.estado === 'BORRADOR';

  return (
    <div className="space-y-5">
      <Link href="/envios" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Envíos
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-brand-500" />
                  <span className="font-mono">{envio.codigo}</span>
                </CardTitle>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-ink-soft dark:text-gray-400">
              <p>
                Destino: <strong className="text-ink dark:text-gray-100">{envio.destino.nombre}</strong>
                {envio.destino.ciudad && ` (${envio.destino.ciudad})`}
              </p>
              <p>Creado {fmtFecha(envio.createdAt)}{envio.creadoPor && ` por ${envio.creadoPor}`}</p>
              {envio.cerradoAt && (
                <p>
                  Cerrado {fmtFecha(envio.cerradoAt)}
                  {envio.cerradoPor && ` por ${envio.cerradoPor}`}
                </p>
              )}
            </CardContent>
          </Card>

          {esBorrador && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Escanear paquetes</CardTitle>
                  <ScannerStatus />
                </div>
              </CardHeader>
              <CardContent>
                <div
                  onClick={() => inputRef.current?.focus()}
                  className="cursor-text rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-8 text-center"
                >
                  <ScanLine className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                  <Input
                    ref={inputRef}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') agregar(valor);
                    }}
                    placeholder="Escanea aquí"
                    className="mx-auto max-w-xs text-center font-mono text-lg"
                    autoFocus
                  />
                  <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">Solo se pueden agregar paquetes &quot;En Paquetería&quot; que no estén ya en otro envío.</p>
                </div>

                {ultimoScan && (
                  <div
                    className={cn(
                      'mt-4 flex items-center gap-3 rounded-xl border-2 p-3',
                      ultimoScan.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40' : 'border-red-200 dark:border-red-900/50 bg-red-50/40'
                    )}
                  >
                    {ultimoScan.ok ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" /> : <XCircle className="h-6 w-6 shrink-0 text-red-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold text-ink dark:text-gray-100">{ultimoScan.code}</p>
                      <p className={cn('text-xs', ultimoScan.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{ultimoScan.mensaje}</p>
                    </div>
                    {procesando && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Paquetes ({envio.items.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {envio.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se agregó ningún paquete.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {envio.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-mono font-medium text-ink dark:text-gray-100">{it.code}</span>
                      {esBorrador && (
                        <Button variant="ghost" size="sm" onClick={() => quitar(it)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" /> Quitar
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {esBorrador && (
            <Card>
              <CardHeader>
                <CardTitle>Acciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!confirmarCierre ? (
                  <Button className="w-full" disabled={envio.items.length === 0} onClick={() => setConfirmarCierre(true)}>
                    <Lock className="h-4 w-4" /> Cerrar envío
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Al cerrar, este envío queda <strong>inmutable</strong>: no podrás agregar ni quitar paquetes. Se generará su código QR.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={cerrar} loading={cerrando}>
                        Confirmar cierre
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmarCierre(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {!confirmarCancelar ? (
                  <Button className="w-full" variant="destructive" onClick={() => setConfirmarCancelar(true)}>
                    <Ban className="h-4 w-4" /> Cancelar envío
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3">
                    <p className="text-xs text-red-800 dark:text-red-400">Se cancelará este envío y sus paquetes quedarán libres para otro envío. Esta acción no se puede deshacer.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={cancelar} loading={cancelando}>
                        Confirmar cancelación
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmarCancelar(false)}>
                        Volver
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {envio.estado === 'CERRADO' && envio.qrToken && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-4 w-4" /> QR del envío
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/envios/${envio.id}/qr`} alt={`QR del envío ${envio.codigo}`} className="h-48 w-48 rounded-lg border border-gray-100 dark:border-gray-800" />
                <p className="text-center text-xs text-gray-400 dark:text-gray-500">La sucursal destino podrá escanear este código cuando exista comunicación entre servidores.</p>
              </CardContent>
            </Card>
          )}

          {envio.estado === 'CANCELADO' && (
            <Card>
              <CardContent className="flex items-center gap-2 py-4 text-sm text-gray-400 dark:text-gray-500">
                <Ban className="h-4 w-4" /> Este envío fue cancelado. Sus paquetes ya están disponibles para otros envíos.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
