'use client';

// src/components/configuracion/preferencias-tab.tsx
import * as React from 'react';
import { Save, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';

interface PreferenciasForm {
  idioma: 'es' | 'en';
  zonaHoraria: string;
  formatoFecha: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  formatoHora: '12h' | '24h';
  sonidosActivos: boolean;
}

export function PreferenciasTab() {
  const [form, setForm] = React.useState<PreferenciasForm | null>(null);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/preferencias')
      .then((res) => res.json())
      .then(setForm);
  }, []);

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/preferencias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setFeedback({ ok: true, mensaje: 'Preferencias guardadas.' });
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
        <CardTitle>Preferencias</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="idioma">Idioma</Label>
            <select
              id="idioma"
              value={form.idioma}
              onChange={(e) => setForm({ ...form, idioma: e.target.value as PreferenciasForm['idioma'] })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <Label htmlFor="zonaHoraria">Zona horaria</Label>
            <select
              id="zonaHoraria"
              value={form.zonaHoraria}
              onChange={(e) => setForm({ ...form, zonaHoraria: e.target.value })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="America/La_Paz">América/La Paz (Bolivia)</option>
              <option value="America/Lima">América/Lima</option>
              <option value="America/Bogota">América/Bogotá</option>
              <option value="America/Santiago">América/Santiago</option>
              <option value="America/Argentina/Buenos_Aires">América/Buenos Aires</option>
              <option value="America/Mexico_City">América/Ciudad de México</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div>
            <Label htmlFor="formatoFecha">Formato de fecha</Label>
            <select
              id="formatoFecha"
              value={form.formatoFecha}
              onChange={(e) => setForm({ ...form, formatoFecha: e.target.value as PreferenciasForm['formatoFecha'] })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="DD/MM/YYYY">DD/MM/AAAA</option>
              <option value="MM/DD/YYYY">MM/DD/AAAA</option>
              <option value="YYYY-MM-DD">AAAA-MM-DD</option>
            </select>
          </div>
          <div>
            <Label htmlFor="formatoHora">Formato de hora</Label>
            <select
              id="formatoHora"
              value={form.formatoHora}
              onChange={(e) => setForm({ ...form, formatoHora: e.target.value as PreferenciasForm['formatoHora'] })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="24h">24 horas</option>
              <option value="12h">12 horas (AM/PM)</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink dark:text-gray-100">
          <input
            type="checkbox"
            checked={form.sonidosActivos}
            onChange={(e) => setForm({ ...form, sonidosActivos: e.target.checked })}
          />
          Sonidos del sistema activados (confirmaciones en Recepción, Depósito, etc.)
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
