'use client';

// src/components/configuracion/seguridad-tab.tsx
// Estos valores los lee src/lib/auth.ts (getSession, signSession) y la
// ruta de login en cada request: se aplican de inmediato, sin reiniciar
// el servidor.
import * as React from 'react';
import { Save, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

interface SeguridadForm {
  tiempoMaximoSesionMin: number;
  tiempoMaximoInactividadMin: number;
  cerrarSesionAutomaticamente: boolean;
  maxIntentosLogin: number;
  tiempoBloqueoMin: number;
}

export function SeguridadTab() {
  const [form, setForm] = React.useState<SeguridadForm | null>(null);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/seguridad')
      .then((res) => res.json())
      .then(setForm);
  }, []);

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/seguridad', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setFeedback({ ok: true, mensaje: 'Configuración de seguridad guardada. Se aplica desde el próximo inicio de sesión.' });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setGuardando(false);
    }
  }

  if (!form) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguridad</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tms">Tiempo máximo de sesión (minutos)</Label>
            <Input
              id="tms"
              type="number"
              min={5}
              value={form.tiempoMaximoSesionMin}
              onChange={(e) => setForm({ ...form, tiempoMaximoSesionMin: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="tmi">Tiempo máximo de inactividad (minutos, 0 = deshabilitado)</Label>
            <Input
              id="tmi"
              type="number"
              min={0}
              value={form.tiempoMaximoInactividadMin}
              onChange={(e) => setForm({ ...form, tiempoMaximoInactividadMin: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="mil">Máximo de intentos de inicio de sesión</Label>
            <Input
              id="mil"
              type="number"
              min={1}
              value={form.maxIntentosLogin}
              onChange={(e) => setForm({ ...form, maxIntentosLogin: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="tbm">Tiempo de bloqueo por intentos fallidos (minutos)</Label>
            <Input
              id="tbm"
              type="number"
              min={1}
              value={form.tiempoBloqueoMin}
              onChange={(e) => setForm({ ...form, tiempoBloqueoMin: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink dark:text-gray-100">
          <input
            type="checkbox"
            checked={form.cerrarSesionAutomaticamente}
            onChange={(e) => setForm({ ...form, cerrarSesionAutomaticamente: e.target.checked })}
          />
          Cerrar sesión automáticamente al superar el tiempo máximo de inactividad
        </label>

        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              feedback.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
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
  );
}
