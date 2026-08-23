'use client';

// src/components/importacion/importacion-client.tsx
// Importación masiva de códigos (Fase 2): CSV/XLSX, mapeo de columnas
// visual, previsualización obligatoria, y 3 modos explícitos (solo
// registrar datos / marcar entregados / crear faltantes y entregar).
// Nunca escribe nada sin que el administrador confirme el resumen.
import * as React from 'react';
import Link from 'next/link';
import { Upload, FileText, CheckCircle2, XCircle, HelpCircle, Loader2, History, ClipboardList, PackageCheck, PackagePlus, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type CampoSistema = 'codigo' | 'monto' | 'personaRecoge' | 'celular' | 'cliente' | 'emprendimiento' | 'fecha' | 'hora' | 'fechaRecepcion' | 'observaciones' | 'descripcion';
type TipoImportacion = 'SOLO_REGISTRAR' | 'MARCAR_ENTREGADOS' | 'CREAR_Y_ENTREGAR';

const CAMPOS_SISTEMA: Array<{ value: CampoSistema; label: string }> = [
  { value: 'codigo', label: 'Código' },
  { value: 'monto', label: 'Monto cobrado' },
  { value: 'personaRecoge', label: 'Persona que recogió' },
  { value: 'celular', label: 'Celular de quien recogió' },
  { value: 'cliente', label: 'Cliente / remitente (quien deja)' },
  { value: 'emprendimiento', label: 'Emprendimiento' },
  { value: 'fecha', label: 'Fecha de entrega (AAAA-MM-DD)' },
  { value: 'hora', label: 'Hora de entrega (HH:MM)' },
  { value: 'fechaRecepcion', label: 'Fecha de recepción (DD/MM/AAAA)' },
  { value: 'observaciones', label: 'Observaciones' },
  { value: 'descripcion', label: 'Descripción del paquete' },
];

interface EncabezadoDetectado {
  columna: string;
  sugerido: CampoSistema | null;
}

interface FilaValidada {
  numeroFila: number;
  codigo: string;
  codigoOficial?: string;
  monto?: number;
  personaRecoge?: string;
  celular?: string;
  fechaRecepcionResuelta?: string;
  estado: 'valido' | 'duplicado' | 'invalido' | 'no_encontrado' | 'ya_entregado';
  motivo?: string;
}

interface Resumen {
  detectados: number;
  validos: number;
  duplicados: number;
  invalidos: number;
  noEncontrados: number;
  filas: FilaValidada[];
}

interface ResultadoImportacion {
  tipo: TipoImportacion;
  entregados: number;
  creados: number;
  actualizados: number;
  conError: number;
}

interface RegistroHistorial {
  id: string;
  nombreArchivo: string;
  nombreLote: string | null;
  formato: string;
  tipoImportacion: TipoImportacion;
  detectados: number;
  validos: number;
  marcadosEntregado: number;
  noEncontrados: number;
  creadosFaltantes: number;
  usuario: string;
  createdAt: string;
}

// Antes "no_encontrado" se mostraba con la misma conotacion de problema
// que "invalido" ("No encontrado", ambar) — pero en este sistema ese
// estado es exactamente el caso normal y esperado de "recepcion olvidada"
// (ver crearPaquetesFaltantes en src/lib/importacion.ts): el paquete se
// va a CREAR. Etiquetas y colores ahora dicen que va a pasar, no solo un
// estado tecnico ("Detección inteligente" de la especificación).
const ESTADO_INFO: Record<FilaValidada['estado'], { emoji: string; label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  no_encontrado: { emoji: '🟢', label: 'Nuevo · se creará', variant: 'success' },
  valido: { emoji: '🔵', label: 'Ya existe · se actualizará', variant: 'info' },
  ya_entregado: { emoji: '🟠', label: 'Ya entregado', variant: 'warning' },
  duplicado: { emoji: '🔴', label: 'Duplicado en el archivo', variant: 'danger' },
  invalido: { emoji: '⚫', label: 'No se puede importar', variant: 'danger' },
};

/** Explica en una frase qué va a pasar con esta fila al confirmar — no solo "por qué" (eso ya lo trae f.motivo para los casos problemáticos), sino la ACCIÓN real que ejecutará el tipo de importación elegido. */
function explicacionFila(f: FilaValidada, tipo: TipoImportacion): string {
  if (f.motivo) return f.motivo;
  if (f.estado === 'no_encontrado') {
    return tipo === 'CREAR_Y_ENTREGAR'
      ? 'Se creará este paquete con estos datos y se marcará como entregado.'
      : 'No existe todavía — con el tipo de importación elegido no se creará (cambia a "Crear y entregar" si corresponde).';
  }
  if (f.estado === 'valido') {
    return tipo === 'SOLO_REGISTRAR'
      ? 'Se actualizarán sus datos (nombre, celular, monto) sin cambiar su estado.'
      : 'Se actualizarán sus datos (nombre, celular, monto) y se marcará como entregado.';
  }
  return '';
}

const TIPO_LABEL: Record<TipoImportacion, string> = {
  SOLO_REGISTRAR: 'Solo datos',
  MARCAR_ENTREGADOS: 'Marcar entregados',
  CREAR_Y_ENTREGAR: 'Crear y entregar',
};

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportacionClient() {
  const [archivo, setArchivo] = React.useState<File | null>(null);
  const [arrastrando, setArrastrando] = React.useState(false);
  const [encabezados, setEncabezados] = React.useState<EncabezadoDetectado[] | null>(null);
  const [totalFilas, setTotalFilas] = React.useState<number | null>(null);
  const [mapeo, setMapeo] = React.useState<Array<CampoSistema | null>>([]);
  const [nombreLote, setNombreLote] = React.useState('');
  // Fecha de recepcion de esta lista: por defecto "unica" con la fecha de
  // hoy (mismo criterio de siempre, ver crearPaquetesFaltantes en
  // src/lib/importacion.ts — nunca obliga a nadie a pensar en esto si no
  // importa una lista historica).
  const [modoFechaRecepcion, setModoFechaRecepcion] = React.useState<'unica' | 'por_fila'>('unica');
  const [fechaRecepcionUnica, setFechaRecepcionUnica] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [tipo, setTipo] = React.useState<TipoImportacion>('MARCAR_ENTREGADOS');
  const [procesando, setProcesando] = React.useState<'detectar' | 'previsualizar' | 'confirmar' | null>(null);
  const [resumen, setResumen] = React.useState<Resumen | null>(null);
  const [resultado, setResultado] = React.useState<{ resultado: ResultadoImportacion; importLogId: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [historial, setHistorial] = React.useState<RegistroHistorial[] | null>(null);

  const cargarHistorial = React.useCallback(() => {
    fetch('/api/importacion/historial')
      .then((r) => r.json())
      .then(setHistorial);
  }, []);

  React.useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  function reiniciar(file: File | null) {
    setArchivo(file);
    setEncabezados(null);
    setTotalFilas(null);
    setMapeo([]);
    setResumen(null);
    setResultado(null);
    setError(null);
    setEdiciones({});
  }

  async function elegirArchivo(file: File | null) {
    reiniciar(file);
    if (!file) return;

    setProcesando('detectar');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('accion', 'detectar-columnas');
      const res = await fetch('/api/importacion', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo leer el archivo.');
        return;
      }
      setEncabezados(data.encabezados);
      setTotalFilas(data.totalFilas);
      setMapeo((data.encabezados as EncabezadoDetectado[]).map((e) => e.sugerido));
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setProcesando(null);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    const file = e.dataTransfer.files?.[0];
    if (file) elegirArchivo(file);
  }

  const codigoMapeado = mapeo.includes('codigo');
  const necesitaMapeo = (encabezados?.length ?? 0) > 0;

  // Ediciones puntuales del administrador sobre una fila de la
  // previsualización (Código/Nombre/Celular/Monto) — antes la tabla era
  // de solo lectura y para corregir un dato simple había que volver al
  // Excel. Se guardan por numeroFila y se envían al servidor tanto al
  // re-previsualizar como al confirmar (ver aplicarEdicionesFilas en
  // src/lib/importacion.ts — el servidor vuelve a validar todo desde
  // cero con el valor editado, nunca confía ciegamente en el cliente).
  interface EdicionFila {
    codigo?: string;
    monto?: number;
    personaRecoge?: string;
    celular?: string;
  }
  const [ediciones, setEdiciones] = React.useState<Record<number, EdicionFila>>({});

  function codigoMostrado(f: FilaValidada): string {
    return ediciones[f.numeroFila]?.codigo ?? f.codigoOficial ?? f.codigo;
  }
  function nombreMostrado(f: FilaValidada): string {
    return ediciones[f.numeroFila]?.personaRecoge ?? f.personaRecoge ?? '';
  }
  function celularMostrado(f: FilaValidada): string {
    return ediciones[f.numeroFila]?.celular ?? f.celular ?? '';
  }
  function montoMostrado(f: FilaValidada): number {
    return ediciones[f.numeroFila]?.monto ?? f.monto ?? 0;
  }

  function editarFila(numeroFila: number, campo: keyof EdicionFila, valor: string) {
    setEdiciones((prev) => ({
      ...prev,
      [numeroFila]: { ...prev[numeroFila], [campo]: campo === 'monto' ? Math.max(0, Number(valor) || 0) : valor },
    }));
  }

  function ediciones_a_enviar(): string | null {
    const entradas = Object.entries(ediciones).filter(([, v]) => Object.keys(v).length > 0);
    if (entradas.length === 0) return null;
    return JSON.stringify(entradas.map(([numeroFila, v]) => ({ numeroFila: Number(numeroFila), ...v })));
  }

  async function previsualizar() {
    if (!archivo || procesando) return;
    setProcesando('previsualizar');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', archivo);
      formData.append('accion', 'previsualizar');
      if (necesitaMapeo) formData.append('mapeo', JSON.stringify(mapeo));
      formData.append('modoFechaRecepcion', modoFechaRecepcion);
      if (modoFechaRecepcion === 'unica') formData.append('fechaRecepcionUnica', fechaRecepcionUnica);
      const edicionesJson = ediciones_a_enviar();
      if (edicionesJson) formData.append('ediciones', edicionesJson);
      const res = await fetch('/api/importacion', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo procesar el archivo.');
        return;
      }
      setResumen(data.resumen);
      setResultado(null);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setProcesando(null);
    }
  }

  const countValido = resumen?.filas.filter((f) => f.estado === 'valido').length ?? 0;
  const countYaEntregado = resumen?.filas.filter((f) => f.estado === 'ya_entregado').length ?? 0;
  const countNoEncontrado = resumen?.noEncontrados ?? 0;

  const afectadosPorTipo: Record<TipoImportacion, number> = {
    SOLO_REGISTRAR: countValido + countYaEntregado,
    MARCAR_ENTREGADOS: countValido,
    CREAR_Y_ENTREGAR: countValido + countNoEncontrado,
  };

  const puedeConfirmar = !!resumen && !!archivo && nombreLote.trim().length > 0 && afectadosPorTipo[tipo] > 0;

  async function confirmar() {
    if (!archivo || !puedeConfirmar || procesando) return;
    setProcesando('confirmar');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', archivo);
      formData.append('accion', 'confirmar');
      formData.append('tipo', tipo);
      formData.append('nombreLote', nombreLote.trim());
      if (necesitaMapeo) formData.append('mapeo', JSON.stringify(mapeo));
      formData.append('modoFechaRecepcion', modoFechaRecepcion);
      if (modoFechaRecepcion === 'unica') formData.append('fechaRecepcionUnica', fechaRecepcionUnica);
      const edicionesJson = ediciones_a_enviar();
      if (edicionesJson) formData.append('ediciones', edicionesJson);
      const res = await fetch('/api/importacion', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo confirmar la importación.');
        return;
      }
      setResumen(data.resumen);
      setResultado({ resultado: data.resultado, importLogId: data.importLogId });
      cargarHistorial();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setProcesando(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>1. Elegir archivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onDrop}
            className={cn(
              'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors',
              arrastrando ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-500/10' : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'
            )}
          >
            <Upload className={cn('mx-auto mb-3 h-8 w-8', arrastrando ? 'text-brand-500' : 'text-gray-300 dark:text-gray-600')} strokeWidth={1.5} />
            {archivo ? (
              <div className="space-y-1">
                <p className="flex items-center justify-center gap-2 text-sm font-medium text-ink dark:text-gray-100">
                  <FileText className="h-4 w-4" /> {archivo.name}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {fmtBytes(archivo.size)}
                  {totalFilas !== null && ` · ${totalFilas.toLocaleString('es-BO')} fila(s) detectada(s)`}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-ink dark:text-gray-100">Arrastra el archivo aquí</p>
                <p className="mt-1 text-xs text-ink-soft dark:text-gray-400">o haz clic para seleccionarlo — CSV o XLSX</p>
              </>
            )}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)} />
          </div>

          {procesando === 'detectar' && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-400 dark:text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo archivo…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      {archivo && encabezados !== null && (
        <Card>
          <CardHeader>
            <CardTitle>2. Fecha de recepción de esta lista</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-soft dark:text-gray-400">
              Esta fecha se aplicará a los paquetes de esta importación (afecta días en paquetería, tarifas y estadísticas). No se usa
              automáticamente la fecha de hoy solo porque estés importando hoy.
            </p>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-gray-100">
                <input
                  type="radio"
                  name="modoFechaRecepcion"
                  checked={modoFechaRecepcion === 'unica'}
                  onChange={() => setModoFechaRecepcion('unica')}
                  className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Una fecha para toda la lista
              </label>
              {modoFechaRecepcion === 'unica' && (
                <div className="ml-6 space-y-1">
                  <Label htmlFor="fechaRecepcionUnica">Fecha</Label>
                  <Input
                    id="fechaRecepcionUnica"
                    type="date"
                    value={fechaRecepcionUnica}
                    onChange={(e) => setFechaRecepcionUnica(e.target.value)}
                    className="w-44"
                  />
                </div>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-gray-100">
                <input
                  type="radio"
                  name="modoFechaRecepcion"
                  checked={modoFechaRecepcion === 'por_fila'}
                  onChange={() => setModoFechaRecepcion('por_fila')}
                  className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Usar fecha de cada fila
              </label>
              {modoFechaRecepcion === 'por_fila' && (
                <p className="ml-6 text-xs text-gray-400 dark:text-gray-500">
                  Mapea una columna de tu archivo al campo &quot;Fecha de recepción&quot; en el paso siguiente (formato DD/MM/AAAA). Una fecha
                  inválida en una fila la rechaza en la previsualización.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {necesitaMapeo && encabezados && (
        <Card>
          <CardHeader>
            <CardTitle>3. Confirmar columnas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-soft dark:text-gray-400">
              Revisa a qué campo del sistema corresponde cada columna del archivo. Las que no se pudieron adivinar con seguridad quedaron sin asignar.
            </p>
            <div className="space-y-2">
              {encabezados.map((enc, i) => (
                <div key={`${enc.columna}-${i}`} className="flex flex-col gap-2 rounded-lg border border-gray-100 dark:border-gray-800/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink dark:text-gray-100">
                    <span className="rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 font-mono text-xs">{enc.columna}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                  </div>
                  <select
                    value={mapeo[i] ?? ''}
                    onChange={(e) => {
                      const v = (e.target.value || null) as CampoSistema | null;
                      setMapeo((m) => m.map((x, j) => (j === i ? v : x)));
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm sm:w-64',
                      mapeo[i] ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900' : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10'
                    )}
                  >
                    <option value="">Ignorar esta columna</option>
                    {CAMPOS_SISTEMA.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!codigoMapeado && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <HelpCircle className="h-3.5 w-3.5" /> Asigna una columna al campo &quot;Código&quot; antes de previsualizar.
              </p>
            )}
            <Button onClick={previsualizar} disabled={!codigoMapeado || procesando !== null} loading={procesando === 'previsualizar'}>
              Previsualizar
            </Button>
          </CardContent>
        </Card>
      )}

      {archivo && !necesitaMapeo && encabezados !== null && !resumen && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <p className="text-sm text-ink-soft dark:text-gray-400">Archivo de texto (.txt): una lista de códigos, sin columnas que mapear.</p>
            <Button onClick={previsualizar} disabled={procesando !== null} loading={procesando === 'previsualizar'}>
              Previsualizar
            </Button>
          </CardContent>
        </Card>
      )}

      {resumen && (
        <Card>
          <CardHeader>
            <CardTitle>4. Previsualización</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ResumenNumero label="Detectados" valor={resumen.detectados} />
              <ResumenNumero label="🟢 Nuevos (se crearán)" valor={resumen.noEncontrados} color="text-emerald-600 dark:text-emerald-400" />
              <ResumenNumero label="🔵 Ya existen (se actualizarán)" valor={resumen.validos} color="text-blue-600 dark:text-blue-400" />
              <ResumenNumero label="🔴 Duplicados" valor={resumen.duplicados} color="text-red-600 dark:text-red-400" />
              <ResumenNumero label="⚫ No se pueden importar" valor={resumen.invalidos} color="text-gray-600 dark:text-gray-400" />
            </div>
            <p className="text-xs text-ink-soft dark:text-gray-400">Esto es lo que ocurrirá al confirmar la importación — revisa antes de continuar.</p>

            {/* Móvil: tarjetas — 6 columnas en una tabla de 375px de ancho
                obligaban a achicar el texto hasta hacerlo ilegible o a
                desbordar la pagina horizontalmente. Mismo criterio que el
                historial de lotes mas abajo en este mismo archivo (ver
                "Móvil: tarjetas, no la tabla de escritorio comprimida"). */}
            <p className="text-xs text-ink-soft dark:text-gray-400">
              Puedes corregir Código, Nombre, Celular o Monto de cualquier fila antes de confirmar — no hace falta volver al archivo original.
            </p>

            <div className="max-h-[32rem] space-y-2 overflow-y-auto md:hidden">
              {resumen.filas.map((f) => (
                <div key={f.numeroFila} className="space-y-2 rounded-lg border border-gray-100 dark:border-gray-800/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={codigoMostrado(f)}
                      onChange={(e) => editarFila(f.numeroFila, 'codigo', e.target.value)}
                      className="h-8 w-36 font-mono text-xs"
                    />
                    <Badge variant={ESTADO_INFO[f.estado].variant}>
                      {ESTADO_INFO[f.estado].emoji} {ESTADO_INFO[f.estado].label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">Nombre</label>
                      <Input value={nombreMostrado(f)} onChange={(e) => editarFila(f.numeroFila, 'personaRecoge', e.target.value)} placeholder="—" className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">Celular</label>
                      <Input value={celularMostrado(f)} onChange={(e) => editarFila(f.numeroFila, 'celular', e.target.value)} placeholder="—" className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">Monto (Bs)</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={montoMostrado(f)}
                        onChange={(e) => editarFila(f.numeroFila, 'monto', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col justify-end text-[11px] text-gray-400 dark:text-gray-500">
                      <span>Fila {f.numeroFila}</span>
                      {f.fechaRecepcionResuelta && <span>Recepción: {f.fechaRecepcionResuelta}</span>}
                    </div>
                  </div>
                  {explicacionFila(f, tipo) && <p className="text-xs text-gray-400 dark:text-gray-500">{explicacionFila(f, tipo)}</p>}
                </div>
              ))}
            </div>

            <div className="hidden max-h-[28rem] overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800/60 md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/60">
                  <tr className="text-left text-xs text-gray-400 dark:text-gray-500">
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Nombre</th>
                    <th className="px-3 py-2 font-medium">Celular</th>
                    <th className="px-3 py-2 font-medium">Monto (Bs)</th>
                    <th className="px-3 py-2 font-medium">Recepción</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {resumen.filas.map((f) => (
                    <tr key={f.numeroFila}>
                      <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500">{f.numeroFila}</td>
                      <td className="px-2 py-1">
                        <Input value={codigoMostrado(f)} onChange={(e) => editarFila(f.numeroFila, 'codigo', e.target.value)} className="h-8 w-32 font-mono text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={nombreMostrado(f)} onChange={(e) => editarFila(f.numeroFila, 'personaRecoge', e.target.value)} placeholder="—" className="h-8 w-32 text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={celularMostrado(f)} onChange={(e) => editarFila(f.numeroFila, 'celular', e.target.value)} placeholder="—" className="h-8 w-28 text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.5"
                          value={montoMostrado(f)}
                          onChange={(e) => editarFila(f.numeroFila, 'monto', e.target.value)}
                          className="h-8 w-20 text-xs"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-ink-soft dark:text-gray-400">{f.fechaRecepcionResuelta ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant={ESTADO_INFO[f.estado].variant}>
                          {ESTADO_INFO[f.estado].emoji} {ESTADO_INFO[f.estado].label}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500">{explicacionFila(f, tipo) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Object.keys(ediciones).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2 text-xs text-brand-700 dark:text-brand-400">
                <span>Editaste {Object.keys(ediciones).length} fila{Object.keys(ediciones).length === 1 ? '' : 's'}.</span>
                <Button size="sm" variant="secondary" onClick={previsualizar} loading={procesando === 'previsualizar'}>
                  Revisar cambios
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {resumen && (
        <Card>
          <CardHeader>
            <CardTitle>5. Tipo de importación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TipoCard
                icon={ClipboardList}
                titulo="Solo registrar datos"
                descripcion="Actualiza monto/persona en paquetes que ya existen, sin cambiar su estado."
                cuenta={afectadosPorTipo.SOLO_REGISTRAR}
                activo={tipo === 'SOLO_REGISTRAR'}
                onClick={() => setTipo('SOLO_REGISTRAR')}
              />
              <TipoCard
                icon={PackageCheck}
                titulo="Marcar como ENTREGADOS"
                descripcion="Marca como entregados los paquetes que ya existen en el sistema."
                cuenta={afectadosPorTipo.MARCAR_ENTREGADOS}
                activo={tipo === 'MARCAR_ENTREGADOS'}
                onClick={() => setTipo('MARCAR_ENTREGADOS')}
              />
              <TipoCard
                icon={PackagePlus}
                titulo="Crear faltantes y entregar"
                descripcion="Crea los códigos que nunca pasaron por Recepción y los marca entregados."
                cuenta={afectadosPorTipo.CREAR_Y_ENTREGAR}
                activo={tipo === 'CREAR_Y_ENTREGAR'}
                onClick={() => setTipo('CREAR_Y_ENTREGAR')}
              />
            </div>

            <div className="max-w-sm space-y-1">
              <Label htmlFor="nombreLote">Nombre del lote</Label>
              <Input id="nombreLote" value={nombreLote} onChange={(e) => setNombreLote(e.target.value)} placeholder="Ej: Fajas agosto" />
            </div>

            {afectadosPorTipo[tipo] === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <HelpCircle className="h-3.5 w-3.5" /> Este modo no tiene ninguna fila para procesar con el archivo actual.
              </p>
            )}

            <Button onClick={confirmar} disabled={!puedeConfirmar || procesando !== null} loading={procesando === 'confirmar'}>
              <CheckCircle2 className="h-4 w-4" /> Confirmar importación
            </Button>

            {resultado && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>
                    {resultado.resultado.entregados > 0 && `${resultado.resultado.entregados} entregado(s). `}
                    {resultado.resultado.creados > 0 && `${resultado.resultado.creados} creado(s). `}
                    {resultado.resultado.actualizados > 0 && `${resultado.resultado.actualizados} actualizado(s). `}
                    {resultado.resultado.conError > 0 && `${resultado.resultado.conError} con error.`}
                  </p>
                  <Link href={`/importacion/${resultado.importLogId}`} className="inline-flex items-center gap-1 text-xs font-semibold underline">
                    Ver detalle del lote <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <History className="h-4 w-4" /> Historial de importaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historial === null ? (
            <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : historial.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se realizó ninguna importación.</p>
          ) : (
            <>
              {/* Móvil: tarjetas, no la tabla de escritorio comprimida */}
              <div className="space-y-3 md:hidden">
                {historial.map((h) => (
                  <Link
                    key={h.id}
                    href={`/importacion/${h.id}`}
                    className="block rounded-xl border border-gray-100 dark:border-gray-800/60 p-3 active:bg-gray-50 dark:active:bg-gray-800/40"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-ink dark:text-gray-100">{h.nombreLote ?? h.nombreArchivo}</p>
                      <Badge variant="neutral">{TIPO_LABEL[h.tipoImportacion]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {fmtFechaHora(h.createdAt)} · {h.usuario}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft dark:text-gray-400">
                      <span>{h.detectados} registros</span>
                      <span>{h.marcadosEntregado} entregados</span>
                      {h.creadosFaltantes > 0 && <span>{h.creadosFaltantes} creados</span>}
                    </div>
                  </Link>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800/60 text-left text-xs text-gray-400 dark:text-gray-500">
                      <th className="pb-2 font-medium">Fecha</th>
                      <th className="pb-2 font-medium">Lote</th>
                      <th className="pb-2 font-medium">Tipo</th>
                      <th className="pb-2 text-right font-medium">Detectados</th>
                      <th className="pb-2 text-right font-medium">Válidos</th>
                      <th className="pb-2 text-right font-medium">Entregados</th>
                      <th className="pb-2 text-right font-medium">Creados</th>
                      <th className="pb-2 font-medium">Usuario</th>
                      <th className="pb-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {historial.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{fmtFechaHora(h.createdAt)}</td>
                        <td className="py-2 text-ink dark:text-gray-100">{h.nombreLote ?? '—'}</td>
                        <td className="py-2">
                          <Badge variant="neutral">{TIPO_LABEL[h.tipoImportacion]}</Badge>
                        </td>
                        <td className="py-2 text-right text-ink-soft dark:text-gray-400">{h.detectados}</td>
                        <td className="py-2 text-right text-ink-soft dark:text-gray-400">{h.validos}</td>
                        <td className="py-2 text-right font-medium text-ink dark:text-gray-100">{h.marcadosEntregado}</td>
                        <td className="py-2 text-right text-ink-soft dark:text-gray-400">{h.creadosFaltantes}</td>
                        <td className="py-2 text-ink-soft dark:text-gray-400">{h.usuario}</td>
                        <td className="py-2 text-right">
                          <Link href={`/importacion/${h.id}`} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                            Ver detalle
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResumenNumero({ label, valor, color }: { label: string; valor: number; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3 text-center">
      <p className={cn('text-2xl font-bold', color ?? 'text-ink dark:text-gray-100')}>{valor}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
    </div>
  );
}

function TipoCard({
  icon: Icon,
  titulo,
  descripcion,
  cuenta,
  activo,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  descripcion: string;
  cuenta: number;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-colors',
        activo ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-500/10' : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60'
      )}
    >
      <Icon className={cn('h-5 w-5', activo ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400 dark:text-gray-500')} />
      <p className={cn('text-sm font-semibold', activo ? 'text-brand-700 dark:text-brand-400' : 'text-ink dark:text-gray-100')}>{titulo}</p>
      <p className="text-xs text-ink-soft dark:text-gray-400">{descripcion}</p>
      <span className={cn('text-xs font-semibold', activo ? 'text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-gray-500')}>{cuenta} fila(s) afectada(s)</span>
    </button>
  );
}
