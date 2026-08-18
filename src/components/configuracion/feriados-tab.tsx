'use client';

// src/components/configuracion/feriados-tab.tsx
import * as React from 'react';
import { Search, Plus, Trash2, Pencil, Save, X, Upload, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface FeriadoDTO {
  id: string;
  fecha: string;
  nombre: string;
  activo: boolean;
}

function fmtFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

export function FeriadosTab() {
  const [feriados, setFeriados] = React.useState<FeriadoDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');

  const [mostrarNuevo, setMostrarNuevo] = React.useState(false);
  const [nuevo, setNuevo] = React.useState({ fecha: '', nombre: '' });
  const [guardando, setGuardando] = React.useState(false);

  const [editandoId, setEditandoId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ fecha: '', nombre: '', activo: true });

  const [mostrarImportar, setMostrarImportar] = React.useState(false);
  const [textoImportar, setTextoImportar] = React.useState('');
  const [importando, setImportando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/configuracion/feriados?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setFeriados(data);
    } finally {
      setCargando(false);
    }
  }, [q]);

  React.useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/feriados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevo),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo agregar el feriado.');
        return;
      }
      setFeriados((prev) => [...prev, data].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      setMostrarNuevo(false);
      setNuevo({ fecha: '', nombre: '' });
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(f: FeriadoDTO) {
    setEditandoId(f.id);
    setEditForm({ fecha: f.fecha, nombre: f.nombre, activo: f.activo });
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    try {
      const res = await fetch(`/api/configuracion/feriados/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      setFeriados((prev) => prev.map((f) => (f.id === id ? data : f)).sort((a, b) => a.fecha.localeCompare(b.fecha)));
      setEditandoId(null);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(f: FeriadoDTO) {
    if (!window.confirm(`¿Eliminar el feriado "${f.nombre}" (${fmtFecha(f.fecha)})?`)) return;
    const res = await fetch(`/api/configuracion/feriados/${f.id}`, { method: 'DELETE' });
    if (res.ok) setFeriados((prev) => prev.filter((x) => x.id !== f.id));
  }

  async function importar() {
    setImportando(true);
    setError(null);
    try {
      const lineas = textoImportar
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const feriadosParaImportar = lineas.map((linea) => {
        const [fecha, ...resto] = linea.split(',');
        return { fecha: fecha?.trim() ?? '', nombre: resto.join(',').trim() || 'Feriado' };
      });
      const res = await fetch('/api/configuracion/feriados/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feriados: feriadosParaImportar }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo importar.');
        return;
      }
      setMostrarImportar(false);
      setTextoImportar('');
      await cargar();
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Feriados</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setMostrarImportar((v) => !v)}>
                <Upload className="h-3.5 w-3.5" /> Importar
              </Button>
              <Button size="sm" onClick={() => setMostrarNuevo((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> Agregar feriado
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…" className="pl-9" />
          </div>

          {mostrarNuevo && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4 sm:grid-cols-3">
              <div>
                <Label>Fecha</Label>
                <Input type="date" value={nuevo.fecha} onChange={(e) => setNuevo((f) => ({ ...f, fecha: e.target.value }))} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label>Nombre</Label>
                <Input value={nuevo.nombre} onChange={(e) => setNuevo((f) => ({ ...f, nombre: e.target.value }))} className="mt-1" />
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

          {mostrarImportar && (
            <div className="space-y-2 rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4">
              <Label>Una fecha por línea: YYYY-MM-DD,Nombre</Label>
              <textarea
                value={textoImportar}
                onChange={(e) => setTextoImportar(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm font-mono text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                placeholder={'2026-12-25,Navidad\n2026-01-01,Año Nuevo'}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={importar} loading={importando}>
                  <Upload className="h-3.5 w-3.5" /> Importar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMostrarImportar(false)}>
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
          ) : feriados.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay feriados registrados.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {feriados.map((f) =>
                editandoId === f.id ? (
                  <div key={f.id} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-4">
                    <Input type="date" value={editForm.fecha} onChange={(e) => setEditForm((v) => ({ ...v, fecha: e.target.value }))} />
                    <Input
                      value={editForm.nombre}
                      onChange={(e) => setEditForm((v) => ({ ...v, nombre: e.target.value }))}
                      className="sm:col-span-2"
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-gray-400">
                        <input type="checkbox" checked={editForm.activo} onChange={(e) => setEditForm((v) => ({ ...v, activo: e.target.checked }))} />
                        Activo
                      </label>
                    </div>
                    <div className="flex gap-2 sm:col-span-4">
                      <Button size="sm" onClick={() => guardarEdicion(f.id)} loading={guardando}>
                        <Save className="h-3.5 w-3.5" /> Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)}>
                        <X className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-ink dark:text-gray-100">{fmtFecha(f.fecha)}</span>
                      <span className="text-ink-soft dark:text-gray-400">{f.nombre}</span>
                      {!f.activo && <Badge variant="neutral">Inactivo</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => abrirEdicion(f)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => eliminar(f)}>
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
