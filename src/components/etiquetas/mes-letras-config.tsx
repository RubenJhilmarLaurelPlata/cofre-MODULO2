'use client';

// src/components/etiquetas/mes-letras-config.tsx
// Panel para que el administrador configure la letra de cada mes, usada
// para armar el codigo de las etiquetas. Nunca codificada en el sistema.
import * as React from 'react';
import { Settings2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MESES_LABELS } from '@/lib/meses';

interface MesLetrasConfigProps {
  letras: Record<number, string>;
  onGuardado: (letras: Record<number, string>) => void;
  /** Si es true, el panel siempre se muestra expandido y sin botón para colapsarlo (uso en Configuración, donde es el contenido principal de la pestaña). */
  sinColapsar?: boolean;
}

export function MesLetrasConfig({ letras, onGuardado, sinColapsar = false }: MesLetrasConfigProps) {
  const [abierto, setAbierto] = React.useState(sinColapsar);
  const [valores, setValores] = React.useState<Record<number, string>>(letras);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValores(letras);
  }, [letras]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/etiquetas/mes-letras', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letras: MESES_LABELS.map((_, i) => ({ mes: i + 1, letra: valores[i + 1] ?? '' })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      onGuardado(data);
      if (!sinColapsar) setAbierto(false);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        <Settings2 className="h-3.5 w-3.5" /> Letra de los meses
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Letra de cada mes</CardTitle>
          {!sinColapsar && (
            <button onClick={() => setAbierto(false)} className="rounded-lg p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-ink dark:hover:text-gray-100" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-ink-soft dark:text-gray-400">
          Cada mes usa una letra en el código de la etiqueta (ej. junio = J en &quot;M24J-1&quot;). Puedes cambiarla cuando quieras; los
          códigos ya generados no se alteran.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {MESES_LABELS.map((nombre, i) => {
            const mes = i + 1;
            return (
              <div key={mes}>
                <label className="mb-1 block text-xs font-medium text-ink-soft dark:text-gray-400">{nombre}</label>
                <Input
                  value={valores[mes] ?? ''}
                  onChange={(e) => setValores((v) => ({ ...v, [mes]: e.target.value.toUpperCase().slice(0, 2) }))}
                  maxLength={2}
                  className="text-center font-mono uppercase"
                />
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button size="sm" onClick={guardar} loading={guardando}>
          <Save className="h-3.5 w-3.5" /> Guardar letras
        </Button>
      </CardContent>
    </Card>
  );
}
