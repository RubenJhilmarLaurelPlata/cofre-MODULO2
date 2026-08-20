'use client';

// src/components/configuracion/respaldos-tab.tsx
import * as React from 'react';
import { HardDrive, Download, XCircle, CheckCircle2, Cloud, RotateCcw, ChevronDown } from 'lucide-react';
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

interface RespaldoOracleDTO {
  nombre: string;
  tamanioBytes: number;
  fecha: string | null;
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

function OracleRespaldosTab() {
  const [conectado, setConectado] = React.useState<boolean | null>(null);
  const [objetos, setObjetos] = React.useState<RespaldoOracleDTO[]>([]);
  const [errorEstado, setErrorEstado] = React.useState<string | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [respaldando, setRespaldando] = React.useState(false);
  const [mostrarLista, setMostrarLista] = React.useState(false);
  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(null);
  const [restaurando, setRestaurando] = React.useState<string | null>(null);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/configuracion/respaldos/oracle');
      const data = await res.json();
      setConectado(!!data.ok);
      setObjetos(data.objetos ?? []);
      setErrorEstado(data.ok ? null : data.error ?? 'No se pudo conectar con Oracle Object Storage.');
    } finally {
      setCargando(false);
    }
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  async function respaldarAhora() {
    setRespaldando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/configuracion/respaldos/oracle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ ok: false, texto: data.error ?? 'No se pudo crear el respaldo.' });
        return;
      }
      setMensaje({ ok: true, texto: 'Respaldo creado y subido correctamente a Oracle Object Storage.' });
      await cargar();
    } catch {
      setMensaje({ ok: false, texto: 'Error de conexión al intentar respaldar.' });
    } finally {
      setRespaldando(false);
    }
  }

  async function restaurar(nombre: string) {
    if (restaurando) return;
    if (
      !window.confirm(
        `¿Confirmas restaurar la base de datos desde "${nombre}"? Esto reemplaza los datos actuales (se guarda una copia de seguridad antes de hacerlo) y requiere reiniciar el servicio para tener efecto.`
      )
    )
      return;
    setRestaurando(nombre);
    setMensaje(null);
    try {
      const res = await fetch('/api/configuracion/respaldos/oracle/restaurar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombreArchivo: nombre }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ ok: false, texto: data.error ?? 'No se pudo restaurar el respaldo.' });
        return;
      }
      setMensaje({ ok: true, texto: data.mensaje ?? 'Restauración completada.' });
    } catch {
      setMensaje({ ok: false, texto: 'Error de conexión al intentar restaurar.' });
    } finally {
      setRestaurando(null);
    }
  }

  const ultimo = objetos[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Cloud className="h-4 w-4" /> Oracle Object Storage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {cargando ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Verificando conexión…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-ink dark:text-gray-100">
                {conectado ? '🟢' : '🔴'} {conectado ? 'Oracle Object Storage conectado' : 'No se pudo conectar'}
              </span>
            </div>
            {!conectado && errorEstado && <p className="text-xs text-red-600 dark:text-red-400">{errorEstado}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                <p className="text-[11px] text-ink-soft dark:text-gray-400">Último respaldo</p>
                <p className="text-sm font-semibold text-ink dark:text-gray-100">{ultimo?.fecha ? fmtFechaHora(ultimo.fecha) : '—'}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                <p className="text-[11px] text-ink-soft dark:text-gray-400">Tamaño</p>
                <p className="text-sm font-semibold text-ink dark:text-gray-100">{ultimo ? fmtTamanio(ultimo.tamanioBytes) : '—'}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={respaldarAhora} loading={respaldando}>
                <HardDrive className="h-3.5 w-3.5" /> Respaldar ahora
              </Button>
              <Button variant="secondary" onClick={() => setMostrarLista((v) => !v)}>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mostrarLista ? 'rotate-180' : ''}`} /> Ver respaldos
              </Button>
            </div>

            {mensaje && (
              <div
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
                  mensaje.ok
                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                }`}
              >
                {mensaje.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {mensaje.texto}
              </div>
            )}

            {mostrarLista && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800/60">
                {objetos.length === 0 ? (
                  <p className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">No hay respaldos disponibles en Oracle.</p>
                ) : (
                  objetos.map((o) => (
                    <div key={o.nombre} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <div>
                        <p className="font-mono font-medium text-ink dark:text-gray-100">{o.nombre}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {o.fecha ? fmtFechaHora(o.fecha) : '—'} · {fmtTamanio(o.tamanioBytes)}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => restaurar(o.nombre)} loading={restaurando === o.nombre}>
                        <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
      <OracleRespaldosTab />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Copia local descargable</CardTitle>
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
