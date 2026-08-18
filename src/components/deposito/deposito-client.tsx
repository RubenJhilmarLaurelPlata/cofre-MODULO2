'use client';

// src/components/deposito/deposito-client.tsx
import * as React from 'react';
import { Archive, ArrowDownToLine, ScanLine, CheckCircle2, XCircle, RefreshCw, Camera as CameraIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { reportarEscaneoExitoso } from '@/lib/scanner/hid-provider';
import { onEscaneoCaptureJs } from '@/lib/scanner/capture-js-provider';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';
import type { PackageDetailDTO } from '@/lib/package-detail';

interface DepositoClientProps {
  pendientesIniciales: PackageDetailDTO[];
  enviadosHoyInicial: number;
}

interface ResultadoScan {
  ok: boolean;
  code: string;
  mensaje: string;
  hora: string;
}

function horaActual(): string {
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function fmtFecha(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function DepositoClient({ pendientesIniciales, enviadosHoyInicial }: DepositoClientProps) {
  const [tab, setTab] = React.useState<'enviar' | 'bajar'>('enviar');
  const [metodo, setMetodo] = React.useState<'usb' | 'camara'>('usb');

  const [valorEnviar, setValorEnviar] = React.useState('');
  const [ultimoEnviar, setUltimoEnviar] = React.useState<ResultadoScan | null>(null);
  const [historialEnviar, setHistorialEnviar] = React.useState<ResultadoScan[]>([]);
  const [enviadosHoy, setEnviadosHoy] = React.useState(enviadosHoyInicial);

  const [valorBajar, setValorBajar] = React.useState('');
  const [ultimoBajar, setUltimoBajar] = React.useState<ResultadoScan | null>(null);
  const [pendientes, setPendientes] = React.useState(pendientesIniciales);
  const [actualizandoLista, setActualizandoLista] = React.useState(false);

  const inputEnviarRef = React.useRef<HTMLInputElement | null>(null);
  const inputBajarRef = React.useRef<HTMLInputElement | null>(null);

  async function procesarEnviar(code: string) {
    try {
      const res = await fetch('/api/deposito/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        const resultado: ResultadoScan = { ok: false, code, mensaje: data.error ?? 'No se pudo enviar el paquete a depósito.', hora: horaActual() };
        setUltimoEnviar(resultado);
        setHistorialEnviar((prev) => [resultado, ...prev].slice(0, 20));
        playSound('error');
        return;
      }

      const resultado: ResultadoScan = { ok: true, code: data.code, mensaje: 'Enviado a depósito.', hora: horaActual() };
      setUltimoEnviar(resultado);
      setHistorialEnviar((prev) => [resultado, ...prev].slice(0, 20));
      setEnviadosHoy((n) => n + 1);
      reportarEscaneoExitoso();
      playSound('deposito');
    } catch {
      const resultado: ResultadoScan = { ok: false, code, mensaje: 'Error de conexión. Intenta de nuevo.', hora: horaActual() };
      setUltimoEnviar(resultado);
      setHistorialEnviar((prev) => [resultado, ...prev].slice(0, 20));
      playSound('error');
    }
  }

  async function procesarBajar(code: string) {
    try {
      const res = await fetch('/api/deposito/bajar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        const resultado: ResultadoScan = { ok: false, code, mensaje: data.error ?? 'No se pudo bajar el paquete de depósito.', hora: horaActual() };
        setUltimoBajar(resultado);
        playSound('error');
        return;
      }

      const resultado: ResultadoScan = { ok: true, code: data.code, mensaje: 'Bajado de depósito. Ahora está En Paquetería.', hora: horaActual() };
      setUltimoBajar(resultado);
      setPendientes((prev) => prev.filter((p) => p.code !== data.code));
      reportarEscaneoExitoso();
      playSound('ok');
    } catch {
      const resultado: ResultadoScan = { ok: false, code, mensaje: 'Error de conexión. Intenta de nuevo.', hora: horaActual() };
      setUltimoBajar(resultado);
      playSound('error');
    }
  }

  // Motor unico de cola (compartido con Recepcion/Entrega/Buscador, ver
  // src/lib/scanner/use-scan-queue.ts) — antes esta pantalla era la
  // unica que DESHABILITABA el input mientras procesaba, lo que hacia
  // que el lector "perdiera" en silencio cualquier escaneo que llegara
  // durante ese tiempo. Ahora nunca se pierde ni se bloquea, igual que
  // el resto del sistema. Cada operacion (enviar/bajar) tiene su propia
  // cola porque son dos flujos independientes.
  const { encolar: encolarEnviar, procesando: procesandoEnviar } = useScanQueue<string>({
    procesar: procesarEnviar,
    inputRef: inputEnviarRef,
    debeEnfocar: () => tab === 'enviar' && metodo === 'usb',
  });
  const { encolar: encolarBajar, procesando: procesandoBajar } = useScanQueue<string>({
    procesar: procesarBajar,
    inputRef: inputBajarRef,
    debeEnfocar: () => tab === 'bajar' && metodo === 'usb',
  });

  // Punto de entrada unico por operacion: normaliza al recibir (ver
  // src/lib/codigo.ts:normalizarEntradaEscaneo — "L17A'29" siempre se
  // procesa/muestra como "L17A-29") y limpia el campo de inmediato,
  // antes de esperar la respuesta.
  function enviarADeposito(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    setValorEnviar('');
    if (!code) return;
    encolarEnviar(code);
  }

  function bajarDeDeposito(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    setValorBajar('');
    if (!code) return;
    encolarBajar(code);
  }

  // Recupera el foco al volver de la pestaña Camara a la de Lector USB,
  // o al cambiar entre Enviar/Bajar (el foco inicial y el de despues de
  // cada escaneo ya los cubre el hook de arriba).
  React.useEffect(() => {
    if (metodo !== 'usb') return;
    if (tab === 'enviar') inputEnviarRef.current?.focus();
    else inputBajarRef.current?.focus();
  }, [tab, metodo]);

  // Escaneos por CaptureSDK (Application Mode, si esta habilitado) se
  // dirigen a la operacion activa (Enviar o Bajar) — mismo punto de
  // entrada unico que HID/camara/tecleo manual, nunca un camino aparte.
  const tabRef = React.useRef(tab);
  tabRef.current = tab;
  React.useEffect(
    () =>
      onEscaneoCaptureJs((code) => {
        if (tabRef.current === 'enviar') enviarADeposito(code);
        else bajarDeDeposito(code);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function actualizarPendientes() {
    setActualizandoLista(true);
    try {
      const res = await fetch('/api/deposito/pendientes');
      if (res.ok) setPendientes(await res.json());
    } finally {
      setActualizandoLista(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Depósito</CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                <ScannerStatus />
                <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
                  <button
                    onClick={() => setTab('enviar')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      tab === 'enviar' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                    )}
                  >
                    <Archive className="h-3.5 w-3.5" /> Enviar a depósito
                  </button>
                  <button
                    onClick={() => setTab('bajar')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      tab === 'bajar' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                    )}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" /> Bajar de depósito
                  </button>
                </div>
                <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
                  <button
                    onClick={() => setMetodo('usb')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      metodo === 'usb' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                    )}
                  >
                    <ScanLine className="h-3.5 w-3.5" /> Lector USB
                  </button>
                  <button
                    onClick={() => setMetodo('camara')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      metodo === 'camara' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                    )}
                  >
                    <CameraIcon className="h-3.5 w-3.5" /> Cámara
                  </button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {metodo === 'camara' ? (
              <div className="mx-auto max-w-sm">
                <CameraScanner onDetect={tab === 'enviar' ? enviarADeposito : bajarDeDeposito} />
                <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">
                  {tab === 'enviar'
                    ? 'Cada código detectado pasa automáticamente a "En Depósito".'
                    : 'Solo los paquetes "Pendiente de bajar" pueden volver a "En Paquetería" por aquí.'}
                </p>
              </div>
            ) : tab === 'enviar' ? (
              <div
                onClick={() => inputEnviarRef.current?.focus()}
                className="cursor-text rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-8 text-center"
              >
                <ScanLine className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                <Input
                  ref={inputEnviarRef}
                  value={valorEnviar}
                  onChange={(e) => setValorEnviar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') enviarADeposito(valorEnviar);
                  }}
                  placeholder="Escanea aquí"
                  className="mx-auto max-w-xs text-center font-mono text-lg"
                  autoFocus
                  // Nunca se deshabilita: un escaneo que llega mientras el
                  // anterior todavia se procesa se ENCOLA (ver
                  // useScanQueue), nunca se descarta ni se bloquea.
                />
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                  Cada código escaneado pasa automáticamente a &quot;En Depósito&quot;. No hace falta confirmar uno por uno.
                </p>
              </div>
            ) : (
              <div
                onClick={() => inputBajarRef.current?.focus()}
                className="cursor-text rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-8 text-center"
              >
                <ScanLine className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                <Input
                  ref={inputBajarRef}
                  value={valorBajar}
                  onChange={(e) => setValorBajar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') bajarDeDeposito(valorBajar);
                  }}
                  placeholder="Escanea aquí"
                  className="mx-auto max-w-xs text-center font-mono text-lg"
                  autoFocus
                  // Nunca se deshabilita — ver comentario arriba.
                />
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                  Solo los paquetes &quot;Pendiente de bajar&quot; pueden volver a &quot;En Paquetería&quot; por aquí.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {tab === 'enviar' && ultimoEnviar && (
          <Card className={cn('border-2', ultimoEnviar.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40' : 'border-red-200 dark:border-red-900/50 bg-red-50/40')}>
            <CardContent className="flex items-center gap-4">
              {ultimoEnviar.ok ? (
                <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="h-9 w-9 shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xl font-semibold text-ink dark:text-gray-100">{ultimoEnviar.code}</p>
                <p className={cn('text-sm', ultimoEnviar.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{ultimoEnviar.mensaje}</p>
              </div>
              {procesandoEnviar && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
            </CardContent>
          </Card>
        )}

        {tab === 'bajar' && ultimoBajar && (
          <Card className={cn('border-2', ultimoBajar.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40' : 'border-red-200 dark:border-red-900/50 bg-red-50/40')}>
            <CardContent className="flex items-center gap-4">
              {ultimoBajar.ok ? (
                <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="h-9 w-9 shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xl font-semibold text-ink dark:text-gray-100">{ultimoBajar.code}</p>
                <p className={cn('text-sm', ultimoBajar.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{ultimoBajar.mensaje}</p>
              </div>
              {procesandoBajar && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
            </CardContent>
          </Card>
        )}

        {tab === 'enviar' && (
          <Card>
            <CardHeader>
              <CardTitle>Historial de esta sesión</CardTitle>
            </CardHeader>
            <CardContent>
              {historialEnviar.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">Aún no se envió ningún paquete a depósito.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {historialEnviar.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {item.ok ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className="font-mono font-medium text-ink dark:text-gray-100">{item.code}</span>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{item.hora}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === 'bajar' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pendientes de bajar ({pendientes.length})</CardTitle>
                <Button variant="ghost" size="sm" onClick={actualizarPendientes} loading={actualizandoLista}>
                  <RefreshCw className="h-3.5 w-3.5" /> Actualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {pendientes.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">No hay paquetes pendientes de bajar.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pendientes.map((p) => (
                    <div key={p.code} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <span className="font-mono font-medium text-ink dark:text-gray-100">{p.code}</span>
                        {p.observaciones && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{p.observaciones}</span>}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">Solicitado {fmtFecha(p.pendienteAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Archive className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-ink-soft dark:text-gray-400">Enviados a depósito hoy</p>
              <p className="text-2xl font-semibold text-ink dark:text-gray-100">{enviadosHoy}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white">
              <ArrowDownToLine className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-ink-soft dark:text-gray-400">Pendientes de bajar</p>
              <p className="text-2xl font-semibold text-ink dark:text-gray-100">{pendientes.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
