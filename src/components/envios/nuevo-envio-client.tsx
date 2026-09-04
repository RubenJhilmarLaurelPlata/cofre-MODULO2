'use client';

// src/components/envios/nuevo-envio-client.tsx
// Paso 1 del flujo (ver auditoría de Fase 2): elegir destino, crear, y
// redirigir al detalle — ahí es donde se escanean los paquetes. No
// permite crear un envío sin destino (el <select> exige una elección
// real, nunca uno "por defecto" adivinado).
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Container, MapPin, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface DestinoDTO {
  id: string;
  codigo: string;
  nombre: string;
  ciudad: string | null;
  activa: boolean;
}

export function NuevoEnvioClient() {
  const router = useRouter();
  const [destinos, setDestinos] = React.useState<DestinoDTO[]>([]);
  const [destinoId, setDestinoId] = React.useState('');
  const [cargando, setCargando] = React.useState(true);
  const [creando, setCreando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/destinos')
      .then((res) => res.json())
      .then((data: DestinoDTO[]) => setDestinos(data.filter((d) => d.activa)))
      .finally(() => setCargando(false));
  }, []);

  async function crear() {
    if (!destinoId) {
      setError('Selecciona un destino para continuar.');
      return;
    }
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinoId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear el envío.');
        return;
      }
      router.push(`/envios/${data.id}`);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link href="/envios" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="h-4 w-4" /> Envíos
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Container className="h-5 w-5 text-brand-500" /> Nuevo envío
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-soft dark:text-gray-400">
            Elige la sucursal de destino. Después de crear el envío podrás escanear directamente los códigos de los paquetes — no hace falta que hayan pasado antes por Recepción.
          </p>

          {cargando ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Cargando destinos…</p>
          ) : destinos.length === 0 ? (
            <p className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Todavía no hay ningún destino activo configurado. Pide a un administrador que cree uno en Configuración → Destinos.
            </p>
          ) : (
            <div className="space-y-2">
              {destinos.map((d) => (
                <label
                  key={d.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    destinoId === d.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <input type="radio" name="destino" value={d.id} checked={destinoId === d.id} onChange={() => setDestinoId(d.id)} className="h-4 w-4 text-brand-600" />
                  <div>
                    <p className="text-sm font-medium text-ink dark:text-gray-100">{d.nombre}</p>
                    {d.ciudad && (
                      <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                        <MapPin className="h-3 w-3" /> {d.ciudad}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <Button onClick={crear} loading={creando} disabled={destinos.length === 0} className="w-full">
            Crear envío
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
