'use client';

// src/components/finanzas/corregir-cobro-tab.tsx
// Permite al Administrador/Supervisor corregir un cobro ya registrado.
// Nunca borra el valor anterior: cada corrección queda como un
// movimiento AJUSTE nuevo en el ledger de Pago del paquete (ver
// src/lib/package-transitions.ts:registrarPago).
import * as React from 'react';
import { Search, History, PlusCircle, MinusCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import type { PackageDetailDTO } from '@/lib/package-detail';

interface Pago {
  id: string;
  tipo: string;
  monto: number;
  montoAnterior: number | null;
  montoNuevo: number | null;
  motivo: string | null;
  usuario: string;
  createdAt: string;
}

const TIPO_LABEL: Record<string, string> = { ANTICIPO: 'Anticipo', COBRO_ENTREGA: 'Cobro en entrega', AJUSTE: 'Ajuste' };

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function CorregirCobroTab() {
  const [query, setQuery] = React.useState('');
  const [buscando, setBuscando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paquete, setPaquete] = React.useState<PackageDetailDTO | null>(null);
  const [pagos, setPagos] = React.useState<Pago[]>([]);

  const [montoDelta, setMontoDelta] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; texto: string } | null>(null);

  async function buscar() {
    const code = query.trim();
    if (!code || buscando) return;
    setBuscando(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/finanzas/paquetes/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setPaquete(null);
        setPagos([]);
        setError(data.error ?? 'No se encontró el paquete.');
        return;
      }
      setPaquete(data.paquete);
      setPagos(data.pagos);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setBuscando(false);
    }
  }

  async function aplicarAjuste(signo: 1 | -1) {
    if (!paquete || guardando) return;
    const monto = Number(montoDelta);
    if (!monto || monto <= 0) {
      setFeedback({ ok: false, texto: 'Indica un monto mayor a 0.' });
      return;
    }
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/finanzas/paquetes/${encodeURIComponent(paquete.code)}/ajustar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ montoDelta: monto * signo, motivo: motivo.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, texto: data.error ?? 'No se pudo aplicar el ajuste.' });
        return;
      }
      setPaquete(data);
      setMontoDelta('');
      setMotivo('');
      setFeedback({ ok: true, texto: 'Ajuste aplicado correctamente.' });
      const pagosRes = await fetch(`/api/finanzas/paquetes/${encodeURIComponent(paquete.code)}`);
      const pagosData = await pagosRes.json();
      if (pagosRes.ok) setPagos(pagosData.pagos);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Buscar paquete</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscar()}
                placeholder="Código del paquete"
                className="pl-9 font-mono"
              />
            </div>
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </CardContent>
        </Card>

        {paquete && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <History className="h-4 w-4" /> Historial de pagos — {paquete.code}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <p className="text-ink-soft dark:text-gray-400">
                  Calculado: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.costoAcumulado.toFixed(2)}</span>
                </p>
                <p className="text-ink-soft dark:text-gray-400">
                  Pagado: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.montoPagado.toFixed(2)}</span>
                </p>
                <p className="text-ink-soft dark:text-gray-400">
                  Saldo: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.saldoPendiente.toFixed(2)}</span>
                </p>
              </div>
              {pagos.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Este paquete no tiene pagos registrados todavía.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagos.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="text-ink dark:text-gray-100">
                          {TIPO_LABEL[p.tipo] ?? p.tipo}
                          {p.montoAnterior !== null && p.montoNuevo !== null && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {' '}
                              ({paquete.moneda} {p.montoAnterior.toFixed(2)} → {paquete.moneda} {p.montoNuevo.toFixed(2)})
                            </span>
                          )}
                        </p>
                        {p.motivo && <p className="text-xs text-gray-400 dark:text-gray-500">Motivo: {p.motivo}</p>}
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {p.usuario} · {fmtFechaHora(p.createdAt)}
                        </p>
                      </div>
                      <span className={p.monto >= 0 ? 'shrink-0 font-medium text-emerald-600 dark:text-emerald-400' : 'shrink-0 font-medium text-red-600 dark:text-red-400'}>
                        {p.monto >= 0 ? '+' : ''}
                        {paquete.moneda} {p.monto.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {paquete && (
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Corregir cobro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ajuste-monto">Monto del ajuste ({paquete.moneda})</Label>
              <Input id="ajuste-monto" type="number" min={0} step="0.5" value={montoDelta} onChange={(e) => setMontoDelta(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ajuste-motivo">Motivo (opcional)</Label>
              <Input id="ajuste-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: cliente frecuente, error de cobro" />
            </div>
            {feedback && (
              <p className={feedback.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-red-600 dark:text-red-400'}>{feedback.texto}</p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => aplicarAjuste(1)} loading={guardando}>
                <PlusCircle className="h-4 w-4" /> Sumar
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => aplicarAjuste(-1)} loading={guardando}>
                <MinusCircle className="h-4 w-4" /> Restar
              </Button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              &quot;Sumar&quot; registra un cobro adicional; &quot;Restar&quot; reduce lo cobrado (ej. un descuento). El monto anterior nunca se
              borra, queda en el historial.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
