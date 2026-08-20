'use client';

// src/components/recepcion/recepcion-client.tsx
import * as React from 'react';
import { ScanLine, Camera as CameraIcon, Keyboard, CheckCircle2, XCircle, PackagePlus, PackageCheck, Layers, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { TecladoVirtual } from '@/components/scanner/teclado-virtual';
import { ClientePagoPanel, type ClienteForm } from '@/components/recepcion/cliente-pago-panel';
import { QuienRecogePanel, type RecogeForm } from '@/components/recepcion/quien-recoge-panel';
import { PagoSelector, type PagoForm } from '@/components/recepcion/pago-selector';
import { LoteActivoPanel } from '@/components/recepcion/lote-activo-panel';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { reportarEscaneoExitoso } from '@/lib/scanner/hid-provider';
import { onEscaneoCaptureJs } from '@/lib/scanner/capture-js-provider';
import { focusScanner } from '@/lib/scanner/focus-scanner';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { normalizarEntradaEscaneo } from '@/lib/codigo';

export type { PagoForm };

interface SerieInfo {
  inicial: string;
  descripcion: string;
}

interface ResultadoScan {
  ok: boolean;
  code: string;
  mensaje: string;
  serieDescripcion?: string;
  costoAcumulado?: number;
  hora: string;
}

interface RecepcionClientProps {
  moneda: string;
  tarifaBase: number;
  montosRapidos: number[];
  series: SerieInfo[];
  ingresadosHoyInicial: number;
  separador: string;
  esAdmin: boolean;
}

const CLIENTE_VACIO: ClienteForm = { nombre: '', emprendimiento: '', telefono: '', observaciones: '' };
const RECOGE_VACIO: RecogeForm = { nombre: '', telefono: '', observaciones: '' };
const VENTANA_DUPLICADO_MS = 1500;

function horaActual(): string {
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

export function RecepcionClient({ moneda, tarifaBase, montosRapidos, series, ingresadosHoyInicial, separador, esAdmin }: RecepcionClientProps) {
  const primerMonto = montosRapidos[0] ?? tarifaBase;
  const PAGO_VACIO: PagoForm = { pagado: false, monto: primerMonto };

  const [tab, setTab] = React.useState<'usb' | 'camara' | 'teclado'>('usb');
  const [valor, setValor] = React.useState('');
  const [ultimo, setUltimo] = React.useState<ResultadoScan | null>(null);
  const [historialSesion, setHistorialSesion] = React.useState<ResultadoScan[]>([]);
  const [ingresadosHoy, setIngresadosHoy] = React.useState(ingresadosHoyInicial);
  // Se incrementa tras cada registro exitoso para que LoteActivoPanel
  // (componente hermano) sepa que debe refrescar su progreso usados/cantidad.
  const [loteActivoToken, setLoteActivoToken] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Proteccion contra doble lectura accidental del mismo codigo (ej. el
  // lector dispara dos veces por un movimiento de mano), sin ralentizar
  // escaneos legitimos de codigos distintos o del mismo codigo mas tarde.
  const ultimoRegistradoRef = React.useRef<{ code: string; at: number } | null>(null);

  // Cliente/foto/pago/recoge (opcionales): se mantienen entre escaneos
  // para que varios paquetes de la misma persona no obliguen a
  // reescribir los datos — ver ClientePagoPanel/QuienRecogePanel. La foto
  // y la descripcion se limpian despues de cada registro exitoso porque
  // son especificas de cada paquete fisico.
  const [cliente, setCliente] = React.useState<ClienteForm>(CLIENTE_VACIO);
  const [clienteId, setClienteId] = React.useState<string | null>(null);
  const [recoge, setRecoge] = React.useState<RecogeForm>(RECOGE_VACIO);
  const [foto, setFoto] = React.useState<string | null>(null);
  const [descripcion, setDescripcion] = React.useState('');
  const [pago, setPago] = React.useState<PagoForm>(PAGO_VACIO);

  // Lote ("Varios paquetes"): puramente de sesion/UI, cada escaneo sigue
  // creando un Package individual real — ver especificacion, "Lote →
  // paquetes individuales". Desactivado por defecto.
  const [loteActivo, setLoteActivo] = React.useState(false);
  const [loteCantidadInput, setLoteCantidadInput] = React.useState('');
  const [lote, setLote] = React.useState<{ cantidad: number; codigoInicial: string | null; registrados: number } | null>(null);
  const loteCompletado = lote !== null && lote.registrados >= lote.cantidad;

  const enfocarInput = React.useCallback(() => {
    if (tab === 'usb') focusScanner(inputRef);
  }, [tab]);

  React.useEffect(() => {
    enfocarInput();
  }, [enfocarInput]);

  function limpiarCliente() {
    setCliente(CLIENTE_VACIO);
    setClienteId(null);
  }

  function iniciarLote() {
    const cantidad = Number(loteCantidadInput);
    if (!cantidad || cantidad < 1) return;
    setLote({ cantidad, codigoInicial: null, registrados: 0 });
  }

  function cancelarLote() {
    // Los paquetes ya registrados NO se eliminan: esto solo apaga el
    // seguimiento de progreso en pantalla.
    setLoteActivo(false);
    setLote(null);
    setLoteCantidadInput('');
  }

  // Cola de escaneos (correccion critica): antes, un segundo escaneo que
  // llegaba mientras el primero todavia estaba en vuelo se descartaba en
  // silencio (input deshabilitado durante el POST) — un operador rapido
  // podia "perder" paquetes sin darse cuenta. Ahora cada escaneo se
  // ENCOLA de inmediato (nunca se pierde, nunca se concatena — el campo
  // se limpia en el mismo instante) y se procesa en orden, uno a la vez.
  // Cada item guarda una FOTO de cliente/pago/foto/descripcion/recoge tal
  // como estaban en el momento exacto del escaneo, para que cambiar la
  // condicion de pago mientras un escaneo anterior todavia se esta
  // procesando nunca contamine el paquete que ya se habia escaneado antes.
  interface EscaneoEncolado {
    code: string;
    enLoteActivo: boolean;
    snapshot: {
      clienteId: string | null;
      cliente: ClienteForm;
      foto: string | null;
      descripcion: string;
      recoge: RecogeForm;
      pago: PagoForm;
    };
  }
  function registrar(codigoCrudo: string, opts?: { forzarFueraDeLote?: boolean }) {
    // Normalizacion al RECIBIR el escaneo (motor unico, ver
    // src/lib/codigo.ts:normalizarEntradaEscaneo): "L17A'29" se convierte
    // en "L17A-29" antes de mostrar u ocupar nada — nunca despues del
    // POST. El backend vuelve a normalizar por su cuenta como respaldo
    // (nunca confia solo en el cliente).
    const code = normalizarEntradaEscaneo(codigoCrudo);
    if (!code) return;

    // Limpieza SINCRONICA e inmediata, antes de esperar cualquier
    // resultado: el campo debe quedar vacio y listo para el siguiente
    // escaneo en el mismo instante en que se acepta este, sin importar
    // cuanto tarde la respuesta del servidor. Si esto se deja para
    // despues de esperar la red, un lector rapido puede escribir el
    // codigo siguiente ENCIMA del que todavia no se limpio, concatenando
    // ambos (ej. "L12A-9L12A-12") — ese es el bug que se corrige aqui.
    setValor('');

    if (loteActivo && loteCompletado && !opts?.forzarFueraDeLote) {
      playSound('duplicado');
      setUltimo({ ok: false, code, mensaje: `El lote ya está completo (${lote?.registrados}/${lote?.cantidad}). Inicia un lote nuevo o registra este paquete individualmente.`, hora: horaActual() });
      enfocarInput();
      return;
    }

    const ultimoReg = ultimoRegistradoRef.current;
    if (ultimoReg && ultimoReg.code === code && Date.now() - ultimoReg.at < VENTANA_DUPLICADO_MS) {
      enfocarInput();
      return; // lectura duplicada casi inmediata del mismo codigo: se ignora en silencio
    }

    encolar({
      code,
      enLoteActivo: loteActivo,
      snapshot: { clienteId, cliente, foto, descripcion, recoge, pago },
    });
  }

  async function procesarUno({ code, snapshot, enLoteActivo }: EscaneoEncolado) {
    try {
      const body: Record<string, unknown> = { code };
      if (snapshot.clienteId) {
        body.clienteId = snapshot.clienteId;
      } else if (snapshot.cliente.nombre || snapshot.cliente.emprendimiento || snapshot.cliente.telefono || snapshot.cliente.observaciones) {
        body.cliente = snapshot.cliente;
      }
      if (snapshot.foto) body.foto = snapshot.foto;
      if (snapshot.descripcion.trim()) body.descripcion = snapshot.descripcion.trim();
      if (snapshot.recoge.nombre.trim()) body.destinatario = snapshot.recoge.nombre.trim();
      if (snapshot.recoge.telefono.trim()) body.destinatarioTelefono = snapshot.recoge.telefono.trim();
      if (snapshot.recoge.observaciones.trim()) body.destinatarioObservaciones = snapshot.recoge.observaciones.trim();
      // Tarifa acordada para este paquete (los botones de pago fijan la
      // tarifa aunque no se cobre ahora — "POR PAGAR Bs5" significa que
      // el paquete se tasa a Bs5, no al monto base general).
      if (snapshot.pago.monto > 0 && snapshot.pago.monto !== tarifaBase) body.tarifaAcordada = snapshot.pago.monto;
      if (snapshot.pago.pagado && snapshot.pago.monto > 0) body.montoAnticipo = snapshot.pago.monto;

      const res = await fetch('/api/recepcion/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        const resultado: ResultadoScan = { ok: false, code, mensaje: data.error ?? 'No se pudo registrar el paquete.', hora: horaActual() };
        setUltimo(resultado);
        setHistorialSesion((prev) => [resultado, ...prev].slice(0, 20));
        playSound(data.tipo === 'duplicado' ? 'duplicado' : 'error');
        return;
      }

      ultimoRegistradoRef.current = { code: data.code, at: Date.now() };
      reportarEscaneoExitoso();

      const resultado: ResultadoScan = {
        ok: true,
        code: data.code,
        mensaje: `Registrado en ${data.serieDescripcion}`,
        serieDescripcion: data.serieDescripcion,
        costoAcumulado: data.costoAcumulado,
        hora: horaActual(),
      };
      setUltimo(resultado);
      setHistorialSesion((prev) => [resultado, ...prev].slice(0, 20));
      setIngresadosHoy((n) => n + 1);
      setLoteActivoToken((n) => n + 1);
      // setState funcional: siempre lee el estado REAL mas reciente, nunca
      // el de la renderizacion (potencialmente vieja) donde se encolo este item.
      if (data.clienteId) setClienteId((prev) => prev ?? data.clienteId);
      if (snapshot.foto) setFoto((prev) => (prev === snapshot.foto ? null : prev));
      if (snapshot.descripcion) setDescripcion((prev) => (prev === snapshot.descripcion ? '' : prev));
      if (enLoteActivo) {
        setLote((l) => (l ? { ...l, codigoInicial: l.codigoInicial ?? data.code, registrados: l.registrados + 1 } : l));
      }
      playSound('ok');
    } catch {
      const resultado: ResultadoScan = { ok: false, code, mensaje: 'Error de conexión. Intenta de nuevo.', hora: horaActual() };
      setUltimo(resultado);
      setHistorialSesion((prev) => [resultado, ...prev].slice(0, 20));
      playSound('error');
    }
  }

  // Motor unico de cola (compartido con Entrega/Buscador/Deposito, ver
  // src/lib/scanner/use-scan-queue.ts): nunca pierde ni concatena un
  // escaneo, nunca deshabilita el input, y devuelve el foco solo cuando
  // la pestaña activa es "usb" (con la camara abierta no tiene sentido
  // robarle el foco al video).
  const { encolar, procesando } = useScanQueue<EscaneoEncolado>({
    procesar: procesarUno,
    inputRef,
    debeEnfocar: () => tab === 'usb',
  });

  // Escaneos que llegan por CaptureSDK (Application Mode, si esta
  // habilitado en Configuracion) alimentan el mismo registrar() que HID y
  // la entrada manual — nunca un camino paralelo. El ref evita cerrar
  // sobre un "registrar" desactualizado sin tener que resuscribirse en
  // cada render.
  const registrarRef = React.useRef(registrar);
  registrarRef.current = registrar;
  React.useEffect(() => onEscaneoCaptureJs((code) => registrarRef.current(code)), []);

  return (
    // Una sola rejilla — en movil es el orden natural del DOM (escaner
    // primero, datos opcionales al final); desde md (tablet, 768px) cada
    // bloque se reubica con col-start/row-start explicitos (izquierda:
    // escaner + resultado + historial; derecha: pago + lote + info) sin
    // duplicar ningun componente con estado (el input del lector solo
    // existe una vez en el DOM).
    <div className="space-y-4 md:grid md:grid-cols-3 md:items-start md:gap-5 md:space-y-0">
      {/* 1. Escanear (izquierda) — su propio item de grid en la fila 1,
          junto a "Condicion de pago" (derecha, ver mas abajo): en movil,
          sin grid activo, esto pone Condicion de pago inmediatamente
          despues de Escanear en el DOM (el flujo pedido:
          ESCANEAR -> CONDICION DE PAGO -> REGISTRAR -> SIGUIENTE), antes
          que "Ultimos paquetes" (que ahora va en la fila 2, ver abajo). */}
      <div className="space-y-4 md:col-start-1 md:col-span-2 md:row-start-1">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-brand-500" /> Escanear
            </CardTitle>
            <div className="flex items-center gap-3">
              <ScannerStatus />
              <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
                <button
                  onClick={() => setTab('usb')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === 'usb' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  <ScanLine className="h-3.5 w-3.5" /> Lector USB
                </button>
                <button
                  onClick={() => setTab('camara')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === 'camara' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  <CameraIcon className="h-3.5 w-3.5" /> Cámara
                </button>
                <button
                  onClick={() => setTab('teclado')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === 'teclado' ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
                  )}
                >
                  <Keyboard className="h-3.5 w-3.5" /> Teclado
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {tab === 'usb' ? (
            <div>
              <div onClick={enfocarInput} className="cursor-text rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-6 text-center sm:p-8">
                <ScanLine className="mx-auto mb-2.5 h-7 w-7 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
                <Input
                  ref={inputRef}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') registrar(valor);
                  }}
                  placeholder="Escanea aquí"
                  className="mx-auto max-w-xs text-center font-mono text-lg"
                  autoFocus
                  // Nunca se deshabilita: un escaneo que llega mientras el
                  // anterior todavia se procesa se ENCOLA (ver registrar()),
                  // nunca se descarta ni se bloquea. Bloquear el campo aqui
                  // fue justamente lo que antes hacia que un lector rapido
                  // "perdiera" escaneos en silencio.
                />
                <p className="mt-2.5 text-xs text-gray-400 dark:text-gray-500">
                  El cursor queda siempre listo aquí — solo escanea el siguiente paquete.
                </p>
              </div>
              {/* Alternativa manual: nunca es obligatoria, el flujo principal no la necesita. */}
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => registrar(valor)} disabled={!valor.trim()} loading={procesando}>
                  Registrar
                </Button>
              </div>
            </div>
          ) : tab === 'camara' ? (
            <CameraScanner onDetect={registrar} />
          ) : (
            <TecladoVirtual onDetect={registrar} />
          )}

          {/* Ultimo resultado: forma parte del escaner, no una tarjeta aparte. */}
          {ultimo && (
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border-2 px-3.5 py-2.5',
                ultimo.ok ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-500/5' : 'border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-500/5'
              )}
            >
              {ultimo.ok ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" /> : <XCircle className="h-6 w-6 shrink-0 text-red-500" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-base font-semibold text-ink dark:text-gray-100">{ultimo.code}</p>
                <p className={cn('text-xs', ultimo.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{ultimo.mensaje}</p>
              </div>
              {ultimo.ok && ultimo.costoAcumulado !== undefined && (
                <span className="shrink-0 text-sm font-semibold text-ink dark:text-gray-100">
                  {moneda} {ultimo.costoAcumulado.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {/* Varios paquetes (lote de sesion): desactivado por defecto. */}
          <div className="rounded-lg border border-gray-100 dark:border-gray-800/60 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink dark:text-gray-100">
              <input
                type="checkbox"
                checked={loteActivo}
                onChange={(e) => {
                  setLoteActivo(e.target.checked);
                  if (!e.target.checked) {
                    setLote(null);
                    setLoteCantidadInput('');
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              <Layers className="h-4 w-4 text-ink-soft dark:text-gray-400" />
              Varios paquetes
            </label>

            {loteActivo && !lote && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-soft dark:text-gray-400">¿Cuántos paquetes dejará?</span>
                <Input
                  type="number"
                  min={1}
                  value={loteCantidadInput}
                  onChange={(e) => setLoteCantidadInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && iniciarLote()}
                  className="w-24"
                  autoFocus
                />
                <Button size="sm" onClick={iniciarLote}>
                  Iniciar lote
                </Button>
              </div>
            )}

            {loteActivo && lote && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-400">
                  <PackageCheck className="h-4 w-4" />
                  {loteCompletado ? 'LOTE COMPLETADO' : `LOTE ${lote.codigoInicial ?? '—'}`} · {lote.registrados}/{lote.cantidad} paquetes
                </span>
                <button type="button" onClick={cancelarLote} className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                  <X className="h-3.5 w-3.5" /> Cancelar lote
                </button>
              </div>
            )}

            {loteActivo && loteCompletado && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Los {lote?.registrados} paquetes ya quedaron registrados. Inicia un lote nuevo para continuar, o registra este paquete fuera del lote.
                </p>
                <Button size="sm" variant="ghost" onClick={() => setLote(null)}>
                  Nuevo lote
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </div>

      {/* 2. Condicion de pago (derecha, fila 1) — a proposito su propio
          item de grid junto a Escanear, no agrupado con Lote/Ingresados/
          Series (que ahora van en la fila 2): esto es lo que adelanta
          Condicion de pago en el orden movil sin tocar PagoSelector. */}
      <div className="space-y-4 md:col-start-3 md:row-start-1">
        <Card>
          <CardHeader>
            <CardTitle>Condición de pago</CardTitle>
          </CardHeader>
          <CardContent>
            <PagoSelector moneda={moneda} montosRapidos={montosRapidos} pago={pago} onPagoChange={setPago} />
          </CardContent>
        </Card>
      </div>

      {/* 3. Ultimos paquetes (izquierda, fila 2). */}
      <div className="space-y-4 md:col-start-1 md:col-span-2 md:row-start-2">
      <Card>
        <CardHeader>
          <CardTitle>Últimos paquetes</CardTitle>
        </CardHeader>
        <CardContent>
          {historialSesion.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">Aún no se registró ningún paquete.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {historialSesion.map((item, i) => (
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
      </div>

      {/* 4. Lote activo + Ingresados hoy + Series configuradas (derecha,
          fila 2) — agrupados en un solo item de grid, mismo criterio de
          "una celda alta por columna" que ya usaba todo este bloque antes
          (evita sincronizar alturas fila por fila con la columna
          izquierda). */}
      <div className="space-y-4 md:col-start-3 md:row-start-2">
        <LoteActivoPanel moneda={moneda} separador={separador} esAdmin={esAdmin} actualizarToken={loteActivoToken} />

        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
            <PackagePlus className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-[11px] text-ink-soft dark:text-gray-400">Ingresados hoy</p>
            <p className="text-lg font-bold text-ink dark:text-gray-100">{ingresadosHoy}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Series configuradas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {series.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No hay series activas configuradas.</p>
            ) : (
              series.map((s) => (
                <div key={s.inicial} className="flex items-center justify-between text-sm">
                  <span className="font-mono font-semibold text-ink dark:text-gray-100">{s.inicial}</span>
                  <span className="text-ink-soft dark:text-gray-400">{s.descripcion}</span>
                </div>
              ))
            )}
            <p className="pt-2 text-xs text-gray-400 dark:text-gray-500">
              Solo se pueden registrar códigos cuya inicial esté aquí. Se configuran en Configuración → Series.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 5. Datos opcionales — colapsados por defecto, menor prioridad. */}
      <div className="space-y-3 md:col-start-1 md:col-span-3 md:row-start-3">
        <ClientePagoPanel
          clienteAsociadoId={clienteId}
          cliente={cliente}
          onClienteChange={setCliente}
          onLimpiarCliente={limpiarCliente}
          foto={foto}
          onFotoChange={setFoto}
          descripcion={descripcion}
          onDescripcionChange={setDescripcion}
        />
        <QuienRecogePanel recoge={recoge} onRecogeChange={setRecoge} />
      </div>
    </div>
  );
}
