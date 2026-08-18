'use client';

// src/components/configuracion/tipos-codigo-tab.tsx
// Administra PackageSeries: la misma tabla que ya usan Recepcion,
// Etiquetas y Buscador. Eliminar solo esta permitido si nunca se uso
// (verificado contra Package y GeneratedCode reales, nunca supuesto).
import * as React from 'react';
import { Plus, Trash2, Pencil, Save, X, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface SerieDTO {
  inicial: string;
  descripcion: string;
  tarifaBaseOverride: number | null;
  activo: boolean;
  correlativo: number;
}

export function TiposCodigoTab() {
  const [series, setSeries] = React.useState<SerieDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [mostrarNuevo, setMostrarNuevo] = React.useState(false);
  const [nuevo, setNuevo] = React.useState({ inicial: '', descripcion: '', tarifaBaseOverride: '' });
  const [guardando, setGuardando] = React.useState(false);

  const [editando, setEditando] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ descripcion: '', tarifaBaseOverride: '', activo: true });

  const cargar = React.useCallback(async () => {
    setCargando(true);
    const res = await fetch('/api/configuracion/series');
    const data = await res.json();
    if (res.ok) setSeries(data);
    setCargando(false);
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inicial: nuevo.inicial,
          descripcion: nuevo.descripcion,
          tarifaBaseOverride: nuevo.tarifaBaseOverride ? Number(nuevo.tarifaBaseOverride) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear.');
        return;
      }
      setSeries((prev) => [...prev, data].sort((a, b) => a.inicial.localeCompare(b.inicial)));
      setMostrarNuevo(false);
      setNuevo({ inicial: '', descripcion: '', tarifaBaseOverride: '' });
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(s: SerieDTO) {
    setEditando(s.inicial);
    setEditForm({ descripcion: s.descripcion, tarifaBaseOverride: s.tarifaBaseOverride?.toString() ?? '', activo: s.activo });
  }

  async function guardarEdicion(inicial: string) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/configuracion/series/${inicial}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descripcion: editForm.descripcion,
          tarifaBaseOverride: editForm.tarifaBaseOverride ? Number(editForm.tarifaBaseOverride) : null,
          activo: editForm.activo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      setSeries((prev) => prev.map((s) => (s.inicial === inicial ? data : s)));
      setEditando(null);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(s: SerieDTO) {
    if (!window.confirm(`¿Eliminar el tipo "${s.inicial}"? Solo se puede si nunca se usó.`)) return;
    setError(null);
    const res = await fetch(`/api/configuracion/series/${s.inicial}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'No se pudo eliminar.');
      return;
    }
    setSeries((prev) => prev.filter((x) => x.inicial !== s.inicial));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Tipos de código</CardTitle>
            <Button size="sm" onClick={() => setMostrarNuevo((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> Nuevo tipo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mostrarNuevo && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4 sm:grid-cols-3">
              <div>
                <Label>Inicial</Label>
                <Input
                  value={nuevo.inicial}
                  onChange={(e) => setNuevo((f) => ({ ...f, inicial: e.target.value.toUpperCase().slice(0, 4) }))}
                  className="mt-1 font-mono uppercase"
                  placeholder="M, S, P, L, X…"
                />
              </div>
              <div>
                <Label>Descripción</Label>
                <Input value={nuevo.descripcion} onChange={(e) => setNuevo((f) => ({ ...f, descripcion: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Tarifa especial (opcional)</Label>
                <Input
                  type="number"
                  min={0}
                  value={nuevo.tarifaBaseOverride}
                  onChange={(e) => setNuevo((f) => ({ ...f, tarifaBaseOverride: e.target.value }))}
                  className="mt-1"
                  placeholder="Deja vacío para usar la tarifa base"
                />
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <Button size="sm" onClick={crear} loading={guardando}>
                  <Save className="h-3.5 w-3.5" /> Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMostrarNuevo(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

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
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {series.map((s) =>
                editando === s.inicial ? (
                  <div key={s.inicial} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-4">
                    <Input value={editForm.descripcion} onChange={(e) => setEditForm((v) => ({ ...v, descripcion: e.target.value }))} className="sm:col-span-2" />
                    <Input
                      type="number"
                      min={0}
                      value={editForm.tarifaBaseOverride}
                      onChange={(e) => setEditForm((v) => ({ ...v, tarifaBaseOverride: e.target.value }))}
                      placeholder="Tarifa especial"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-gray-400">
                      <input type="checkbox" checked={editForm.activo} onChange={(e) => setEditForm((v) => ({ ...v, activo: e.target.checked }))} />
                      Activo
                    </label>
                    <div className="flex gap-2 sm:col-span-4">
                      <Button size="sm" onClick={() => guardarEdicion(s.inicial)} loading={guardando}>
                        <Save className="h-3.5 w-3.5" /> Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                        <X className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={s.inicial} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-base font-bold text-ink dark:text-gray-100">{s.inicial}</span>
                      <span className="text-ink-soft dark:text-gray-400">{s.descripcion}</span>
                      {s.tarifaBaseOverride !== null && <Badge variant="brand">Tarifa especial: {s.tarifaBaseOverride}</Badge>}
                      {!s.activo && <Badge variant="neutral">Inactivo</Badge>}
                      <span className="text-xs text-gray-400 dark:text-gray-500">último consecutivo: {s.correlativo}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEdicion(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => eliminar(s)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
