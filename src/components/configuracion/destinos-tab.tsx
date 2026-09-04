'use client';

// src/components/configuracion/destinos-tab.tsx
// Catalogo de sucursales/destinos a los que ESTA instalacion puede
// enviar paquetes (Fase 2 — modulo Envios). Nace vacio: nada se
// precarga, lo llena el administrador. Ver prisma/schema.prisma
// (SucursalDestino) para el porque no se reutiliza Branch.
import * as React from 'react';
import { Plus, CheckCircle2, XCircle, MapPin, Power } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface DestinoDTO {
  id: string;
  codigo: string;
  nombre: string;
  ciudad: string | null;
  direccion: string | null;
  activa: boolean;
}

export function DestinosTab() {
  const [destinos, setDestinos] = React.useState<DestinoDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  const [mostrarCrear, setMostrarCrear] = React.useState(false);
  const [form, setForm] = React.useState({ codigo: '', nombre: '', ciudad: '', direccion: '' });
  const [creando, setCreando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/configuracion/destinos');
      setDestinos(await res.json());
    } finally {
      setCargando(false);
    }
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear() {
    setCreando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/destinos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo crear el destino.' });
        return;
      }
      setDestinos((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setForm({ codigo: '', nombre: '', ciudad: '', direccion: '' });
      setMostrarCrear(false);
      setFeedback({ ok: true, mensaje: `Destino "${data.nombre}" creado.` });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setCreando(false);
    }
  }

  async function toggleActiva(destino: DestinoDTO) {
    setFeedback(null);
    const res = await fetch(`/api/configuracion/destinos/${destino.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activa: !destino.activa }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo actualizar el destino.' });
      return;
    }
    setDestinos((prev) => prev.map((d) => (d.id === destino.id ? data : d)));
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Destinos (sucursales)</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setMostrarCrear((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Crear destino
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Sucursales a las que esta instalación puede preparar envíos (módulo Envíos). Este catálogo empieza vacío a propósito — agrega aquí cada
          sucursal real, sin necesidad de tocar código.
        </p>

        {mostrarCrear && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-100 dark:border-gray-800/60 p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="codigo">Código</Label>
              <Input id="codigo" value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))} className="mt-1" placeholder="ELA" maxLength={10} />
            </div>
            <div>
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="mt-1" placeholder="Cofre Express El Alto" />
            </div>
            <div>
              <Label htmlFor="ciudad">Ciudad</Label>
              <Input id="ciudad" value={form.ciudad} onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))} className="mt-1" placeholder="El Alto" />
            </div>
            <div>
              <Label htmlFor="direccion">Dirección (opcional)</Label>
              <Input id="direccion" value={form.direccion} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={crear} loading={creando} disabled={!form.codigo.trim() || !form.nombre.trim()}>
                Guardar destino
              </Button>
            </div>
          </div>
        )}

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

        {destinos.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no hay ningún destino configurado.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {destinos.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 font-mono text-xs font-semibold text-ink dark:text-gray-200">{d.codigo}</span>
                  <div>
                    <p className="text-sm font-medium text-ink dark:text-gray-100">{d.nombre}</p>
                    {d.ciudad && (
                      <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                        <MapPin className="h-3 w-3" /> {d.ciudad}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={d.activa ? 'success' : 'neutral'}>{d.activa ? 'Activa' : 'Inactiva'}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => toggleActiva(d)}>
                    <Power className="h-3.5 w-3.5" /> {d.activa ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
