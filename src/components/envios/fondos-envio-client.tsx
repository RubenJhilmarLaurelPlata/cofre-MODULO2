'use client';

// src/components/envios/fondos-envio-client.tsx
// "Envíos → Fondos entre sucursales" (Fase 3): dinero cobrado en esta
// instalación por paquetes destinados a otra sucursal, que económicamente
// NO es ingreso propio (ver getFondosPendientesPorDestino() en
// src/lib/envios.ts) — y el registro de su entrega física (liquidación).
// Nunca representa una transferencia bancaria: es la trazabilidad de una
// entrega de efectivo entre sucursales.
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Wallet, HandCoins, CheckCircle2, XCircle, History, Container } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface FondoPorDestinoDTO {
  destinoId: string;
  destinoCodigo: string;
  destinoNombre: string;
  fondosPendientes: number;
  cantidadEnvios: number;
}

interface LiquidacionDTO {
  id: string;
  destino: { id: string; codigo: string; nombre: string };
  monto: number;
  usuario: string | null;
  notas: string | null;
  createdAt: string;
  cantidadEnvios: number;
}

function fmtFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function FondosEnvioClient() {
  const [fondos, setFondos] = React.useState<FondoPorDestinoDTO[]>([]);
  const [liquidaciones, setLiquidaciones] = React.useState<LiquidacionDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [destinoActivo, setDestinoActivo] = React.useState<string | null>(null);
  const [notas, setNotas] = React.useState('');
  const [liquidando, setLiquidando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    const [resFondos, resLiq] = await Promise.all([fetch('/api/envios/fondos'), fetch('/api/envios/liquidaciones')]);
    if (resFondos.ok) setFondos(await resFondos.json());
    if (resLiq.ok) setLiquidaciones(await resLiq.json());
  }, []);

  React.useEffect(() => {
    setCargando(true);
    cargar().finally(() => setCargando(false));
  }, [cargar]);

  async function liquidar(destinoId: string) {
    setLiquidando(true);
    setError(null);
    try {
      const res = await fetch('/api/envios/liquidaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinoId, notas: notas.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo registrar la liquidación.');
        return;
      }
      setDestinoActivo(null);
      setNotas('');
      await cargar();
    } finally {
      setLiquidando(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/envios" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Envíos
      </Link>

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-brand-900 p-6 text-white">
        <Wallet className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 -rotate-12 text-white/[0.06]" strokeWidth={1} aria-hidden />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-500/30">
            <Wallet className="h-5 w-5 text-brand-400" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">Fondos entre sucursales</p>
            <p className="text-sm text-gray-300">Dinero cobrado aquí que corresponde a otra sucursal.</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fondos pendientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cargando ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
          ) : fondos.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">No hay fondos pendientes de liquidar.</p>
          ) : (
            fondos.map((f) => (
              <div key={f.destinoId} className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Container className="h-4 w-4 text-brand-500" />
                    <p className="font-medium text-ink dark:text-gray-100">{f.destinoNombre}</p>
                  </div>
                  <p className="text-lg font-semibold text-brand-600 dark:text-brand-400">Bs {f.fondosPendientes.toFixed(2)}</p>
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {f.cantidadEnvios} envío{f.cantidadEnvios === 1 ? '' : 's'} sin liquidar
                </p>

                {destinoActivo === f.destinoId ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Confirma que entregaste físicamente <strong>Bs {f.fondosPendientes.toFixed(2)}</strong> a {f.destinoNombre}. Esta acción no se puede deshacer.
                    </p>
                    <textarea
                      value={notas}
                      onChange={(e) => setNotas(e.target.value)}
                      placeholder="Notas (opcional)"
                      rows={2}
                      className="flex w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-gray-400 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-brand-500/20"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => liquidar(f.destinoId)} loading={liquidando}>
                        Confirmar entrega de fondos
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setDestinoActivo(null); setNotas(''); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" className="mt-3" onClick={() => setDestinoActivo(f.destinoId)}>
                    <HandCoins className="h-3.5 w-3.5" /> Registrar entrega de fondos
                  </Button>
                )}
              </div>
            ))
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <History className="h-4 w-4" /> Historial de liquidaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {liquidaciones.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se registró ninguna liquidación.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {liquidaciones.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium text-ink dark:text-gray-100">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> {l.destino.nombre}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {fmtFecha(l.createdAt)}{l.usuario && ` · ${l.usuario}`} · {l.cantidadEnvios} envío{l.cantidadEnvios === 1 ? '' : 's'}
                    </p>
                    {l.notas && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{l.notas}</p>}
                  </div>
                  <p className="shrink-0 font-semibold text-ink dark:text-gray-100">Bs {l.monto.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
