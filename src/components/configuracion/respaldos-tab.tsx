'use client';

// src/components/configuracion/respaldos-tab.tsx
import * as React from 'react';
import { HardDrive, Download, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface RespaldoDTO {
  id: string;
  nombreArchivo: string;
  tamanioBytes: number;
  estado: string;
  usuario: string;
  createdAt: string;
}

function fmtTamanio(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function RespaldosTab() {
  const [respaldos, setRespaldos] = React.useState<RespaldoDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [creando, setCreando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    const res = await fetch('/api/configuracion/respaldos');
    const data = await res.json();
    if (res.ok) setRespaldos(data);
    setCargando(false);
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function crearRespaldo() {
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/respaldos', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear el respaldo.');
      }
      await cargar();
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Respaldos de la base de datos</CardTitle>
            <Button size="sm" onClick={crearRespaldo} loading={creando}>
              <HardDrive className="h-3.5 w-3.5" /> Crear respaldo completo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-ink-soft dark:text-gray-400">
            Cada respaldo es una copia completa del archivo de la base de datos en el momento en que se genera. La restauración automática
            todavía no está disponible; por ahora, descarga el archivo y consérvalo en un lugar seguro.
          </p>
          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {cargando ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
          ) : respaldos.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se creó ningún respaldo.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {respaldos.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-mono font-medium text-ink dark:text-gray-100">{r.nombreArchivo}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {fmtFechaHora(r.createdAt)} · {r.usuario} · {fmtTamanio(r.tamanioBytes)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.estado === 'COMPLETADO' ? 'success' : 'danger'}>{r.estado === 'COMPLETADO' ? 'Completado' : 'Error'}</Badge>
                    {r.estado === 'COMPLETADO' && (
                      <a href={`/api/configuracion/respaldos/${r.id}/descargar`}>
                        <Button size="sm" variant="secondary">
                          <Download className="h-3.5 w-3.5" /> Descargar
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
