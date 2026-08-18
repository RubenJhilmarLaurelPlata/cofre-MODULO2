'use client';

// src/components/configuracion/empresa-tab.tsx
// Estos datos se usan automaticamente en Reportes, PDF, Etiquetas y
// encabezados/impresiones (ya reutilizan getCompanyConfig()).
import * as React from 'react';
import { Save, Upload, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

interface EmpresaForm {
  nombre: string;
  logoUrl: string;
  direccion: string;
  telefono: string;
  email: string;
  sitioWeb: string;
  ciudad: string;
  pais: string;
  horarioAtencion: string;
  moneda: string;
  climaLat: string;
  climaLon: string;
}

const VACIO: EmpresaForm = {
  nombre: '',
  logoUrl: '',
  direccion: '',
  telefono: '',
  email: '',
  sitioWeb: '',
  ciudad: '',
  pais: '',
  horarioAtencion: '',
  moneda: '',
  climaLat: '',
  climaLon: '',
};

export function EmpresaTab() {
  const [form, setForm] = React.useState<EmpresaForm>(VACIO);
  const [cargando, setCargando] = React.useState(true);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/empresa')
      .then((res) => res.json())
      .then((data) =>
        setForm({
          nombre: data.nombre ?? '',
          logoUrl: data.logoUrl ?? '',
          direccion: data.direccion ?? '',
          telefono: data.telefono ?? '',
          email: data.email ?? '',
          sitioWeb: data.sitioWeb ?? '',
          ciudad: data.ciudad ?? '',
          pais: data.pais ?? '',
          horarioAtencion: data.horarioAtencion ?? '',
          moneda: data.moneda ?? '',
          climaLat: data.climaLat ?? '',
          climaLon: data.climaLon ?? '',
        })
      )
      .finally(() => setCargando(false));
  }, []);

  function actualizar<K extends keyof EmpresaForm>(campo: K, valor: EmpresaForm[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function onLogoSeleccionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setFeedback({ ok: false, mensaje: 'El logo debe ser una imagen PNG, JPG, WEBP o GIF.' });
      return;
    }
    if (file.size > 500_000) {
      setFeedback({ ok: false, mensaje: 'El logo es demasiado grande (máximo ~500KB).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => actualizar('logoUrl', String(reader.result));
    reader.readAsDataURL(file);
  }

  async function guardar() {
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/configuracion/empresa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          climaLat: form.climaLat.trim() === '' ? null : Number(form.climaLat),
          climaLon: form.climaLon.trim() === '' ? null : Number(form.climaLon),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setFeedback({ ok: true, mensaje: 'Datos de la empresa guardados.' });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la empresa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logoUrl} alt="Logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">Sin logo</span>
            )}
          </div>
          <div>
            <Label htmlFor="logo">Logo</Label>
            <div className="mt-1">
              <input id="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onLogoSeleccionado} className="hidden" />
              <Button variant="secondary" size="sm" onClick={() => document.getElementById('logo')?.click()}>
                <Upload className="h-3.5 w-3.5" /> Subir imagen
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="nombre">Nombre de la empresa</Label>
            <Input id="nombre" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="moneda">Moneda</Label>
            <Input id="moneda" value={form.moneda} onChange={(e) => actualizar('moneda', e.target.value)} className="mt-1" placeholder="Bs" />
          </div>
          <div>
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" value={form.direccion} onChange={(e) => actualizar('direccion', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="ciudad">Ciudad</Label>
            <Input id="ciudad" value={form.ciudad} onChange={(e) => actualizar('ciudad', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="pais">País</Label>
            <Input id="pais" value={form.pais} onChange={(e) => actualizar('pais', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="telefono">Teléfono</Label>
            <Input id="telefono" value={form.telefono} onChange={(e) => actualizar('telefono', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => actualizar('email', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="sitioWeb">Sitio web (opcional)</Label>
            <Input id="sitioWeb" value={form.sitioWeb} onChange={(e) => actualizar('sitioWeb', e.target.value)} className="mt-1" placeholder="https://…" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="horario">Horario de atención</Label>
            <Input
              id="horario"
              value={form.horarioAtencion}
              onChange={(e) => actualizar('horarioAtencion', e.target.value)}
              className="mt-1"
              placeholder="Lunes a viernes, 8:00 a 18:00"
            />
          </div>
          <div>
            <Label htmlFor="climaLat">Latitud (para el clima del Dashboard)</Label>
            <Input id="climaLat" value={form.climaLat} onChange={(e) => actualizar('climaLat', e.target.value)} className="mt-1" placeholder="-17.3895" />
          </div>
          <div>
            <Label htmlFor="climaLon">Longitud (para el clima del Dashboard)</Label>
            <Input id="climaLon" value={form.climaLon} onChange={(e) => actualizar('climaLon', e.target.value)} className="mt-1" placeholder="-66.1568" />
          </div>
          <p className="sm:col-span-2 text-xs text-gray-400 dark:text-gray-500">
            Opcional. Busca tu ciudad en Google Maps, mantén presionado sobre el mapa para ver las coordenadas y cópialas aquí. Sin coordenadas, el
            Dashboard muestra &quot;Clima no configurado&quot; en vez de inventar un dato.
          </p>
        </div>

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
