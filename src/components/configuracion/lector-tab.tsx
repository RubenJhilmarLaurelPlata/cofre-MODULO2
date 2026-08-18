'use client';

// src/components/configuracion/lector-tab.tsx
// Configuracion del lector S700: HID (por defecto, sin configurar nada)
// vs CaptureSDK/Application Mode (opcional, requiere AppKey de Socket
// Mobile). Ver src/lib/scanner/capture-js-provider.ts para el detalle
// tecnico y las limitaciones reales por plataforma.
import * as React from 'react';
import { Save, CheckCircle2, XCircle, Info, ScanLine, Smartphone, Tablet, Laptop, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

export function LectorTab() {
  const [habilitado, setHabilitado] = React.useState(false);
  const [appId, setAppId] = React.useState('');
  const [developerId, setDeveloperId] = React.useState('');
  const [appKey, setAppKey] = React.useState('');
  const [cargando, setCargando] = React.useState(true);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/lector')
      .then((res) => res.json())
      .then((data) => {
        setHabilitado(!!data.s700Habilitado);
        setAppId(data.s700AppId ?? '');
        setDeveloperId(data.s700DeveloperId ?? '');
        setAppKey(data.s700AppKey ?? '');
      })
      .finally(() => setCargando(false));
  }, []);

  async function guardar() {
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/lector', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s700Habilitado: habilitado, s700AppId: appId, s700DeveloperId: developerId, s700AppKey: appKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setFeedback({ ok: true, mensaje: 'Configuración del lector guardada.' });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-4 w-4" /> Lector S700 — modo HID (siempre activo)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-ink-soft dark:text-gray-400">
            <p>
              Por defecto el S700 funciona como teclado (HID): se empareja por Bluetooth y escribe el código directamente donde esté el
              cursor. Funciona en cualquier navegador — iPhone, iPad, Mac o Windows — sin instalar nada. Este modo nunca se apaga y es el
              respaldo si CaptureSDK no está disponible.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CaptureSDK / Application Mode (opcional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Esta integración está implementada según la documentación oficial de Socket Mobile, pero <strong>no ha sido validada
                todavía contra un lector S700 físico</strong>. El indicador de estado del lector solo muestra &ldquo;conectado&rdquo; cuando el SDK
                recibe una confirmación real del dispositivo — nunca lo asume. HID sigue siendo el modo verificado y activo por defecto;
                actívalo aquí solo cuando quieras probarlo.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink dark:text-gray-100">
              <input
                type="checkbox"
                checked={habilitado}
                onChange={(e) => setHabilitado(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              Habilitar integración con Socket Mobile Capture JS
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="s700-appid">App ID</Label>
                <Input id="s700-appid" value={appId} onChange={(e) => setAppId(e.target.value)} className="mt-1 font-mono text-xs" placeholder="web:tudominio.com" />
              </div>
              <div>
                <Label htmlFor="s700-devid">Developer ID</Label>
                <Input id="s700-devid" value={developerId} onChange={(e) => setDeveloperId(e.target.value)} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label htmlFor="s700-appkey">App Key</Label>
                <Input id="s700-appkey" value={appKey} onChange={(e) => setAppKey(e.target.value)} className="mt-1 font-mono text-xs" type="password" />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3 text-xs text-ink-soft dark:text-gray-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Estas tres credenciales se registran gratis en socketmobile.com (una sola vez, por dominio) y se usan para inicializar el
                SDK en el navegador. Nunca se comparten fuera de este sistema.
              </p>
            </div>

            {feedback && (
              <div
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
                  feedback.ok
                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                }`}
              >
                {feedback.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {feedback.mensaje}
              </div>
            )}

            <Button onClick={guardar} loading={guardando}>
              <Save className="h-4 w-4" /> Guardar cambios
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Qué esperar por plataforma</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-ink-soft dark:text-gray-400">
            <div className="flex gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-medium text-ink dark:text-gray-100">iPhone / iPad:</span> CaptureSDK solo funciona dentro de la app{' '}
                <strong>Rumba</strong> de Socket Mobile (no en Safari). En Safari, el S700 sigue funcionando en modo HID normalmente.
              </p>
            </div>
            <div className="flex gap-2">
              <Tablet className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-medium text-ink dark:text-gray-100">Android / Windows:</span> requiere tener abierta la app gratuita{' '}
                <strong>Socket Mobile Companion</strong> en el mismo equipo.
              </p>
            </div>
            <div className="flex gap-2">
              <Laptop className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-medium text-ink dark:text-gray-100">Mac:</span> hoy no existe una vía CaptureSDK para el S700 desde un
                navegador estándar. En Mac el sistema siempre usa HID.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
