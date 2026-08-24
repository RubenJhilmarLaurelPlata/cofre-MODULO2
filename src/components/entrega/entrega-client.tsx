'use client';

// src/components/entrega/entrega-client.tsx
import * as React from 'react';
import Link from 'next/link';
import {
  Search,
  Truck,
  Ban,
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  XCircle,
  Calendar,
  Clock,
  Wallet,
  User,
  Save,
  SlidersHorizontal,
  Store,
  Phone,
  History as HistoryIcon,
  Pencil,
  X,
  UploadCloud,
  ChevronDown,
  FileText as FileTextIcon,
  Loader2,
  Camera as CameraIcon,
  ScanLine,
  Keyboard,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { DeliveryCountdown } from '@/components/entrega/delivery-countdown';
import { ScannerStatus } from '@/components/scanner/scanner-status';
import { CameraScanner } from '@/components/scanner/camera-scanner';
import { TecladoVirtual } from '@/components/scanner/teclado-virtual';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { reportarEscaneoExitoso } from '@/lib/scanner/hid-provider';
import { onEscaneoCaptureJs } from '@/lib/scanner/capture-js-provider';
import { useScanQueue } from '@/lib/scanner/use-scan-queue';
import { focusScanner } from '@/lib/scanner/focus-scanner';
import { playSound, type SoundType } from '@/lib/sound';
import { normalizarEntradaEscaneo } from '@/lib/codigo';
import { cn } from '@/lib/utils';
import type { PackageDetailDTO, EntregaRecienteDTO } from '@/lib/package-detail';

const ESTADO_PAGO_LABEL: Record<string, string> = { PENDIENTE: 'Pendiente de pago', PARCIAL: 'Pago parcial', PAGADO: 'Pagado' };
const ESTADO_PAGO_VARIANT: Record<string, 'neutral' | 'warning' | 'success'> = { PENDIENTE: 'neutral', PARCIAL: 'warning', PAGADO: 'success' };
const MOTIVO_NO_ENTREGABLE: Record<string, string> = {
  EN_DEPOSITO: 'Este paquete está en depósito. Primero debe solicitarse su bajada y confirmarse desde el módulo de Depósito.',
  PENDIENTE_BAJAR: 'Este paquete ya fue solicitado y está pendiente de bajar físicamente. Una vez bajado, se confirma desde el módulo de Depósito y volverá a "En Paquetería".',
  DENEGADO: 'Este paquete fue denegado y no puede entregarse.',
};

interface EntregaClientProps {
  entregadosHoyInicial: number;
  entregadosRecientesIniciales: EntregaRecienteDTO[];
  codigoInicial?: string;
  paqueteInicial?: PackageDetailDTO | null;
  countdownSegundos: number;
  esAdmin: boolean;
  // Interseccion de roles con acceso a Recepcion Y Entrega (ADMIN,
  // ADMIN_CAJA) — ver PERMISOS_POR_MODULO en src/types/index.ts. Un
  // operador de solo-Entrega nunca recibe paquetes en su rol habitual, asi
  // que no ve ni puede activar "Entrega excepcional".
  puedeEntregaExcepcional: boolean;
  moneda: string;
}

/** Bloque colapsable simple (cerrado por defecto salvo que ya tenga datos), mismo criterio que los paneles opcionales de Recepción — evita que "Quien recoge"/Observaciones alarguen el scroll en móvil antes de llegar a los botones de acción. */
function PanelColapsable({ titulo, icono: Icono, abiertoInicial, children }: { titulo: string; icono: React.ComponentType<{ className?: string }>; abiertoInicial: boolean; children: React.ReactNode }) {
  const [abierto, setAbierto] = React.useState(abiertoInicial);
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between gap-2 p-4 text-left">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
          <Icono className="h-3.5 w-3.5" /> {titulo}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

function fmtFecha(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

function fmtHora(iso: string | Date | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Fecha+hora de ingreso, protagonista en la tarjeta de Entrega (ej. "17/08/2026 · 23:27"), ver seccion 5 de la especificacion. */
function fmtFechaHoraGrande(iso: string | Date | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const hora = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${fecha} · ${hora}`;
}

/**
 * Maquina de estados explicita de Entrega (reemplaza los booleanos
 * descontrolados que existian antes: mostrarCountdown + un ref heuristico
 * "ultimoAutoCountdownRef" para decidir si re-disparar el contador — esa
 * combinacion era la causa raiz de que el SEGUNDO paquete escaneado no
 * reiniciara el contador de forma confiable). Un unico string decide que
 * se muestra: IDLE (nada), SCANNING (buscando el codigo), FOUND
 * (encontrado, sin auto-entrega en curso — ej. EN_DEPOSITO, o EN_PAQUETERIA
 * despues de cancelar manualmente el contador), COUNTDOWN (contador de 5s
 * corriendo), DELIVERING (POST de entrega en vuelo), DELIVERED, ERROR.
 */
type FaseEntrega = 'IDLE' | 'SCANNING' | 'FOUND' | 'COUNTDOWN' | 'DELIVERING' | 'DELIVERED' | 'ERROR';

/** Reduce la respuesta completa de entregar/corregir a los campos que muestra "Entregados recientemente" (ver EntregaRecienteDTO). El lote no viene en esas respuestas — se pasa aparte cuando ya se conoce (ver guardarCorreccion). */
function aEntregaReciente(data: PackageDetailDTO, lote: string | null = null): EntregaRecienteDTO {
  return {
    code: data.code,
    entregaAt: data.entregaAt ?? new Date(),
    montoPagado: data.montoPagado,
    estadoPago: data.estadoPago,
    destinatario: data.destinatario,
    origenEntrega: data.origenEntrega,
    lote,
  };
}

export function EntregaClient({
  entregadosHoyInicial,
  entregadosRecientesIniciales,
  codigoInicial,
  paqueteInicial,
  countdownSegundos,
  esAdmin,
  puedeEntregaExcepcional,
  moneda,
}: EntregaClientProps) {
  const [tab, setTab] = React.useState<'usb' | 'camara' | 'teclado'>('usb');
  // "Entrega excepcional": OFF por defecto (ver seccion 2 de la
  // especificacion). Solo tiene efecto si puedeEntregaExcepcional — el
  // backend igual la rechaza para cualquier otro rol, pero ni siquiera se
  // ofrece el control en pantalla.
  const [excepcionalActivo, setExcepcionalActivo] = React.useState(false);
  const [confirmandoExcepcional, setConfirmandoExcepcional] = React.useState<string | null>(null);
  const [registrandoExcepcional, setRegistrandoExcepcional] = React.useState(false);
  // Motivo obligatorio: sin el, hoy no quedaba ninguna justificacion de
  // por que se omitio Recepcion (ver especificacion, "Entregas
  // excepcionales" — nunca inventar un motivo, pedirlo siempre).
  const [motivoExcepcionalInput, setMotivoExcepcionalInput] = React.useState('');
  const [montoExcepcionalInput, setMontoExcepcionalInput] = React.useState('');
  const resolverExcepcionalRef = React.useRef<(() => void) | null>(null);
  const [query, setQuery] = React.useState(codigoInicial ?? '');
  const [paquete, setPaquete] = React.useState<PackageDetailDTO | null>(paqueteInicial ?? null);
  const [fase, setFase] = React.useState<FaseEntrega>(
    paqueteInicial ? (paqueteInicial.status === 'EN_PAQUETERIA' ? 'COUNTDOWN' : 'FOUND') : codigoInicial ? 'ERROR' : 'IDLE'
  );
  const [mensajeError, setMensajeError] = React.useState<string | null>(
    codigoInicial && !paqueteInicial ? `No se encontró ningún paquete con el código "${codigoInicial}".` : null
  );
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);
  const [accionEnCurso, setAccionEnCurso] = React.useState(false);
  const [entregadosHoy, setEntregadosHoy] = React.useState(entregadosHoyInicial);
  const [entregadosRecientes, setEntregadosRecientes] = React.useState(entregadosRecientesIniciales);

  const [obs, setObs] = React.useState('');
  const [destinatario, setDestinatario] = React.useState('');
  const [destinatarioTelefono, setDestinatarioTelefono] = React.useState('');
  const [destinatarioObs, setDestinatarioObs] = React.useState('');

  const [montoCobrar, setMontoCobrar] = React.useState(0);
  const [motivoCobro, setMotivoCobro] = React.useState('');
  const [personalizarCobro, setPersonalizarCobro] = React.useState(false);

  // Edicion post-entrega (solo ADMIN) de una fila de "Entregados recientemente".
  const [editando, setEditando] = React.useState<string | null>(null);
  const [editMontoAnterior, setEditMontoAnterior] = React.useState(0);
  const [editMonto, setEditMonto] = React.useState(0);
  const [editMotivo, setEditMotivo] = React.useState('');
  const [guardandoCorreccion, setGuardandoCorreccion] = React.useState(false);

  // "Editar" un paquete ya ENTREGADO en la tarjeta principal (no la fila de
  // la lista de abajo, que ya tiene su propia edicion de monto): desbloquea
  // destinatario/telefono/observaciones para corregirlos sin crear un
  // registro nuevo — reutiliza el mismo guardarDatos()/PATCH que ya usan
  // los paquetes activos, el backend nunca bloqueo esto por estado, solo
  // la interfaz lo tenia deshabilitado.
  const [editandoEntregado, setEditandoEntregado] = React.useState(false);

  // Alerta roja "PAQUETE YA ENTREGADO" (seccion 4 de la especificacion):
  // se dispara al ENCONTRAR un paquete que ya esta ENTREGADO (por
  // escaneo, tecleo o camara — el mismo procesarEntrega() de siempre), es
  // muy visible, y se cierra sola a los 2 segundos sin bloquear nada —
  // escanear el siguiente codigo sigue funcionando de inmediato, y el
  // detalle completo del paquete (bajo la alerta) sigue visible despues
  // de que la alerta desaparece.
  const [alertaEntregado, setAlertaEntregado] = React.useState<{ code: string; entregaAt: string | Date | null } | null>(null);
  const alertaEntregadoTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mostrarAlertaEntregado = React.useCallback((code: string, entregaAt: string | Date | null) => {
    if (alertaEntregadoTimeoutRef.current) clearTimeout(alertaEntregadoTimeoutRef.current);
    setAlertaEntregado({ code, entregaAt });
    alertaEntregadoTimeoutRef.current = setTimeout(() => setAlertaEntregado(null), 2000);
  }, []);
  React.useEffect(() => () => {
    if (alertaEntregadoTimeoutRef.current) clearTimeout(alertaEntregadoTimeoutRef.current);
  }, []);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const codigoInicialProcesadoRef = React.useRef<string | undefined>(undefined);
  // Resuelve la promesa que useScanQueue esta esperando dentro de
  // procesarEntrega() (ver mas abajo) — se dispara cuando el ciclo
  // encontrado→contador→entrega de UN paquete termina (entregado,
  // cancelado o con error), y es lo que hace que la cola sea FIFO de
  // verdad: mientras esta promesa sigue pendiente, el siguiente codigo
  // encolado simplemente espera, sin perderse ni cancelar al anterior.
  const resolverCicloRef = React.useRef<(() => void) | null>(null);

  // Soporta llegar desde el Buscador con "?code=" en la URL: precarga el
  // paquete (ya resuelto en el servidor) sin que el operador tenga que
  // volver a escribirlo. El ref evita relanzar esto si el resto del
  // componente vuelve a renderizar por otro motivo. Esta carga inicial no
  // pasa por la cola (no hay nada mas encolado en el primer render), asi
  // que arrancar COUNTDOWN aqui directamente es seguro.
  React.useEffect(() => {
    if (!codigoInicial || codigoInicialProcesadoRef.current === codigoInicial) return;
    codigoInicialProcesadoRef.current = codigoInicial;
    setQuery(codigoInicial);
    if (paqueteInicial) {
      setPaquete(paqueteInicial);
      setMensajeError(null);
      setFase(paqueteInicial.status === 'EN_PAQUETERIA' ? 'COUNTDOWN' : 'FOUND');
      if (paqueteInicial.status === 'ENTREGADO') mostrarAlertaEntregado(paqueteInicial.code, paqueteInicial.entregaAt);
    } else {
      setPaquete(null);
      setFase('ERROR');
      setMensajeError(`No se encontró ningún paquete con el código "${codigoInicial}".`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoInicial, paqueteInicial]);

  React.useEffect(() => {
    setObs(paquete?.observaciones ?? '');
    setDestinatario(paquete?.destinatario ?? '');
    setDestinatarioTelefono(paquete?.destinatarioTelefono ?? '');
    setDestinatarioObs(paquete?.destinatarioObservaciones ?? '');
    // El monto a cobrar por defecto es el saldo pendiente completo (nunca
    // negativo aqui: un saldo a favor del cliente no se "cobra"). El
    // operador puede ajustarlo con "Personalizar monto".
    setMontoCobrar(paquete ? Math.max(0, Math.round(paquete.saldoPendiente * 100) / 100) : 0);
    setMotivoCobro('');
    setPersonalizarCobro(false);
    // Cierra el modo edicion de un entregado tanto al escanear un paquete
    // distinto como al guardar exitosamente (guardarDatos() hace
    // setPaquete(data) con la respuesta ya guardada) — mismo patron
    // "guardar y cerrar" en un solo lugar, sin duplicar el cierre en cada
    // callsite.
    setEditandoEntregado(false);
  }, [paquete]);

  /**
   * Punto unico de procesamiento de UN codigo escaneado en Entrega. A
   * diferencia de Recepcion/Buscador/Deposito (donde "procesar" termina
   * apenas responde la API), aqui la promesa NO se resuelve hasta que el
   * ciclo completo del paquete termina: encontrado → (si esta EN
   * PAQUETERIA) contador de 5s → entrega automatica. Como useScanQueue
   * (ver src/lib/scanner/use-scan-queue.ts) espera esta promesa antes de
   * sacar el siguiente item de la cola, esto es lo que convierte la cola
   * generica en la cola FIFO de ENTREGA que pide la especificacion: si
   * escaneo A, B, C, D seguidos, B/C/D quedan esperando en la cola —
   * ninguno cancela el contador de A — y recien se procesan uno por uno,
   * en orden, a medida que el anterior termina de entregarse.
   * Un codigo invalido/no encontrado, o un paquete que no esta EN
   * PAQUETERIA (no dispara contador), resuelven la promesa de inmediato:
   * un error nunca bloquea la cola.
   */
  async function procesarEntrega(code: string): Promise<void> {
    setFase('SCANNING');
    setMensajeError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404 && excepcionalActivo && puedeEntregaExcepcional) {
          // No figura como recibido y el operador autorizado activo el
          // modo excepcional: se pausa aqui (misma tecnica que COUNTDOWN,
          // ver resolverCicloRef) hasta que confirme o cancele el banner
          // de advertencia — nunca se crea nada sin esa confirmacion
          // explicita.
          setPaquete(null);
          setFase('ERROR');
          setMensajeError(null);
          setConfirmandoExcepcional(code);
          await new Promise<void>((resolve) => {
            resolverExcepcionalRef.current = resolve;
          });
          return;
        }
        setPaquete(null);
        setFase('ERROR');
        setMensajeError(data.error ?? 'No se encontró el paquete.');
        playSound('error');
        return;
      }
      setPaquete(data);
      reportarEscaneoExitoso();
      if (data.status === 'ENTREGADO') {
        // Escanear un paquete que YA esta entregado nunca debe volver a
        // "entregarlo" ni pasar desapercibido como un hallazgo mas — una
        // alerta roja bien visible, con sonido distinto al de un hallazgo
        // normal, que se cierra sola a los 2s sin bloquear el siguiente
        // escaneo (ver mostrarAlertaEntregado arriba).
        mostrarAlertaEntregado(data.code, data.entregaAt);
        playSound('duplicado');
      } else {
        playSound('ok');
      }
      if (data.status !== 'EN_PAQUETERIA') {
        // Encontrado pero no entregable ahora mismo (en deposito,
        // pendiente de bajar, ya entregado, denegado): se muestra su
        // informacion, pero no hay contador que esperar — la cola sigue
        // de largo con el siguiente codigo sin ninguna demora.
        setFase('FOUND');
        return;
      }
      // EN_PAQUETERIA: arranca el contador automatico y la promesa queda
      // pendiente hasta que ese paquete puntual termine su ciclo (ver
      // confirmarEntregaDesdeCountdown/cancelarCountdown, que son los
      // unicos lugares que llaman resolverCicloRef.current()).
      setFase('COUNTDOWN');
      await new Promise<void>((resolve) => {
        resolverCicloRef.current = resolve;
      });
    } catch {
      setPaquete(null);
      setFase('ERROR');
      setMensajeError('Error de conexión. Intenta de nuevo.');
      playSound('error');
    }
  }

  function cancelarExcepcional() {
    const code = confirmandoExcepcional;
    setConfirmandoExcepcional(null);
    setMotivoExcepcionalInput('');
    setMontoExcepcionalInput('');
    setMensajeError(code ? `No se encontró ningún paquete con el código "${code}".` : null);
    resolverExcepcionalRef.current?.();
    resolverExcepcionalRef.current = null;
    focusScanner(inputRef);
  }

  async function confirmarExcepcional() {
    const code = confirmandoExcepcional;
    if (!code || registrandoExcepcional || !motivoExcepcionalInput.trim()) return;
    setRegistrandoExcepcional(true);
    try {
      const montoCobrado = Number(montoExcepcionalInput);
      const res = await fetch(`/api/entrega/${encodeURIComponent(code)}/excepcional`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivoExcepcional: motivoExcepcionalInput.trim(),
          ...(montoExcepcionalInput.trim() && Number.isFinite(montoCobrado) ? { montoCobrado } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConfirmandoExcepcional(null);
        setFase('ERROR');
        setMensajeError(data.error ?? 'No se pudo registrar la entrega excepcional.');
        playSound('error');
        return;
      }
      setConfirmandoExcepcional(null);
      setPaquete(data);
      setFase('FOUND');
      setEntregadosRecientes((prev) => [aEntregaReciente(data), ...prev].slice(0, 15));
      setEntregadosHoy((n) => n + 1);
      reportarEscaneoExitoso();
      playSound('ok');
    } catch {
      setConfirmandoExcepcional(null);
      setFase('ERROR');
      setMensajeError('Error de conexión. No se registró la entrega excepcional.');
      playSound('error');
    } finally {
      setRegistrandoExcepcional(false);
      setMotivoExcepcionalInput('');
      setMontoExcepcionalInput('');
      resolverExcepcionalRef.current?.();
      resolverExcepcionalRef.current = null;
      focusScanner(inputRef);
    }
  }

  // Motor unico de cola (compartido con Recepcion/Buscador/Deposito, ver
  // src/lib/scanner/use-scan-queue.ts): un escaneo que llega mientras el
  // anterior todavia esta en vuelo NUNCA se pierde ni se bloquea — se
  // encola y se procesa en orden, sin deshabilitar nunca el input.
  const { encolar: encolarBusqueda, procesando: buscando } = useScanQueue<string>({
    procesar: procesarEntrega,
    inputRef,
    debeEnfocar: () => tab === 'usb',
  });

  // Recupera el foco al volver de la pestaña Camara a la de Lector USB
  // (el foco inicial y el de despues de cada escaneo ya los cubre el
  // hook de arriba).
  React.useEffect(() => {
    if (tab === 'usb') focusScanner(inputRef);
  }, [tab]);

  // Punto de entrada unico para un escaneo/tecleo con Enter en el campo
  // de busqueda: normaliza al recibir (ver
  // src/lib/codigo.ts:normalizarEntradaEscaneo — "L17A'24" siempre se
  // muestra/busca como "L17A-24") y limpia el campo de inmediato
  // (sincronico, antes de esperar la respuesta) para que un lector
  // rapido nunca pueda escribir el siguiente codigo encima del anterior
  // todavia sin limpiar.
  function escanear(codigoCrudo: string) {
    const code = normalizarEntradaEscaneo(codigoCrudo);
    setQuery('');
    if (!code) return;
    encolarBusqueda(code);
  }

  // Escaneos por CaptureSDK (si esta habilitado) pasan por el mismo punto
  // de entrada unico (escanear) que HID y la entrada manual.
  const escanearRef = React.useRef(escanear);
  escanearRef.current = escanear;
  React.useEffect(() => onEscaneoCaptureJs((code) => escanearRef.current(code)), []);

  function nuevaBusqueda() {
    setPaquete(null);
    setQuery('');
    setMensajeError(null);
    setFase('IDLE');
    focusScanner(inputRef);
  }

  async function ejecutarAccion(accion: 'denegar' | 'enviar-deposito' | 'solicitar-bajar' | 'reingresar', mensajeExito: string, tipoSonido: SoundType = 'ok') {
    if (!paquete || accionEnCurso) return;
    setAccionEnCurso(true);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(paquete.code)}/${accion}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo completar la acción.' });
        playSound('error');
        return;
      }
      setPaquete(data);
      if (accion === 'reingresar') {
        // Igual que reingresarDesdeLista(): si el paquete que se acaba de
        // volver a ingresar seguia visible en "Entregados recientemente"
        // (ej. se entrego hoy mismo y se corrigio al toque), debe salir de
        // ahi y del contador de inmediato — sin esto quedaba mostrado como
        // entregado en la lista hasta recargar la pagina. A diferencia de
        // reingresarDesdeLista() (que solo se puede llamar sobre una fila
        // que YA esta en esa lista), este boton tambien aparece al
        // encontrar por escaneo/busqueda un paquete entregado en un dia
        // anterior — por eso el contador de "hoy" solo baja si el paquete
        // realmente estaba contado ahi.
        const estabaEnListaDeHoy = entregadosRecientes.some((p) => p.code === data.code);
        setEntregadosRecientes((prev) => prev.filter((p) => p.code !== data.code));
        if (estabaEnListaDeHoy) setEntregadosHoy((n) => Math.max(0, n - 1));
      }
      setFeedback({ ok: true, mensaje: mensajeExito });
      playSound(tipoSonido);
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
      playSound('error');
    } finally {
      setAccionEnCurso(false);
      focusScanner(inputRef);
    }
  }

  /** Libera la cola FIFO de Entrega (ver procesarEntrega): se llama exactamente una vez por ciclo, sin importar como termine (entregado, error o cancelado). */
  function liberarCiclo() {
    resolverCicloRef.current?.();
    resolverCicloRef.current = null;
  }

  // Llamado por DeliveryCountdown al llegar a 0 (flujo automatico) — y es
  // el UNICO lugar que efectivamente entrega un paquete; el boton manual
  // "Entregar manualmente" solo arranca el mismo contador, nunca entrega
  // de forma instantanea, para que el comportamiento sea identico sin
  // importar como se disparo.
  async function confirmarEntregaDesdeCountdown() {
    if (!paquete) {
      setFase('IDLE');
      liberarCiclo();
      return;
    }
    setFase('DELIVERING');
    setAccionEnCurso(true);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(paquete.code)}/entregar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observaciones: obs,
          montoCobrado: montoCobrar > 0 ? montoCobrar : undefined,
          motivoCobro: motivoCobro.trim() || undefined,
          destinatario: destinatario.trim() || undefined,
          destinatarioTelefono: destinatarioTelefono.trim() || undefined,
          destinatarioObservaciones: destinatarioObs.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFase('ERROR');
        setMensajeError(data.error ?? 'No se pudo registrar la entrega.');
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo registrar la entrega.' });
        playSound('error');
        return;
      }
      setPaquete(data);
      setFase('DELIVERED');
      setFeedback({ ok: true, mensaje: 'Paquete entregado correctamente.' });
      setEntregadosHoy((n) => n + 1);
      // Entrega hecha desde esta pantalla: nunca es por importación, así
      // que no tiene lote que preservar (a diferencia de una corrección
      // posterior, que sí puede aplicar a un paquete que llegó importado).
      setEntregadosRecientes((prev) => [aEntregaReciente(data), ...prev.filter((p) => p.code !== data.code)].slice(0, 15));
      playSound('ok');
    } catch {
      setFase('ERROR');
      setMensajeError('Error de conexión. La entrega no se registró.');
      setFeedback({ ok: false, mensaje: 'Error de conexión. La entrega no se registró.' });
      playSound('error');
    } finally {
      setAccionEnCurso(false);
      focusScanner(inputRef);
      // Pase lo que pase (entregado o error), este paquete termino su
      // ciclo: la cola FIFO puede avanzar al siguiente codigo encolado.
      liberarCiclo();
    }
  }

  // Cancelar la cuenta regresiva es una salida de emergencia explicita
  // del operador — nunca bloquea la estacion: libera la cola igual que un
  // exito o un error, dejando el paquete visible en pantalla (fase FOUND)
  // para entrega manual con el boton, sin auto-reintentar.
  function cancelarCountdown() {
    setFase('FOUND');
    liberarCiclo();
  }

  async function guardarDatos() {
    if (!paquete) return;
    setAccionEnCurso(true);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(paquete.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observaciones: obs, destinatario, destinatarioTelefono, destinatarioObservaciones: destinatarioObs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setPaquete(data);
      setFeedback({ ok: true, mensaje: 'Datos guardados.' });
    } finally {
      setAccionEnCurso(false);
      focusScanner(inputRef);
    }
  }

  function abrirEdicion(p: EntregaRecienteDTO) {
    setEditando(p.code);
    setEditMontoAnterior(p.montoPagado);
    setEditMonto(p.montoPagado);
    setEditMotivo('');
  }

  const [reingresandoCode, setReingresandoCode] = React.useState<string | null>(null);

  /** "Volver a ingresar" desde la fila de la lista, sin tener que re-escanear el paquete — mismo endpoint que el boton de la tarjeta principal. */
  async function reingresarDesdeLista(code: string) {
    if (reingresandoCode) return;
    setReingresandoCode(code);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(code)}/reingresar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo volver a ingresar el paquete.' });
        playSound('error');
        return;
      }
      // Ya no esta ENTREGADO: sale de "Entregados recientemente" y el
      // contador de hoy baja (best-effort — la fuente real para
      // reportes/dashboard siempre recalcula desde Package.status +
      // entregaAt en la base de datos, esto solo mantiene coherente lo
      // que ya se ve en pantalla en esta sesion).
      setEntregadosRecientes((prev) => prev.filter((p) => p.code !== code));
      setEntregadosHoy((n) => Math.max(0, n - 1));
      if (paquete?.code === code) setPaquete(data);
      if (editando === code) setEditando(null);
      setFeedback({ ok: true, mensaje: `${code} vuelve a estar en paquetería.` });
      playSound('ok');
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. No se volvió a ingresar el paquete.' });
      playSound('error');
    } finally {
      setReingresandoCode(null);
    }
  }

  async function guardarCorreccion(code: string) {
    if (guardandoCorreccion) return;
    setGuardandoCorreccion(true);
    try {
      const res = await fetch(`/api/entrega/${encodeURIComponent(code)}/corregir`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ montoCorregido: editMonto, motivo: editMotivo.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo corregir el paquete.' });
        return;
      }
      // Preserva el lote conocido (la respuesta de corregir no lo trae,
      // ver src/lib/importacion.ts:getLotesPorPackageId — solo se
      // consulta al cargar la pantalla, no en cada corrección).
      setEntregadosRecientes((prev) => prev.map((p) => (p.code === code ? aEntregaReciente(data, p.lote) : p)));
      if (paquete?.code === code) setPaquete(data);
      setFeedback({ ok: true, mensaje: `Corrección guardada para ${code}.` });
      setEditando(null);
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. La corrección no se guardó.' });
    } finally {
      setGuardandoCorreccion(false);
    }
  }

  const puedeEntregar = paquete?.status === 'EN_PAQUETERIA';
  const puedeEnviarDeposito = paquete?.status === 'EN_PAQUETERIA';
  const puedeSolicitarBajar = paquete?.status === 'EN_DEPOSITO';
  const puedeDenegar = paquete && !['ENTREGADO', 'DENEGADO'].includes(paquete.status);
  const esFinal = paquete && ['ENTREGADO', 'DENEGADO'].includes(paquete.status);
  const puedeReingresar = paquete?.status === 'ENTREGADO';
  // "Editar"/"Guardar datos" quedan disponibles tanto en el flujo normal
  // (paquete activo) como en un ENTREGADO una vez que el operador tocó
  // "Editar" — nunca en DENEGADO (esFinal cubre ambos, pero solo
  // ENTREGADO tiene una via explicita de vuelta atras).
  const puedeEditarCampos = !esFinal || editandoEntregado;

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <div className="space-y-5 md:col-span-2">
        {/* Identidad de Entrega: acento rojo/rosa ("salida/entregar") — borde
            superior + chip de icono, nunca la tarjeta entera. Ver Recepcion
            (verde/"entrada") para el contraste equivalente. */}
        <Card className="border-t-4 border-t-rose-400 dark:border-t-rose-500">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-white">
                  <Truck className="h-4 w-4" />
                </span>
                Buscar paquete
                <span className="hidden items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 sm:flex">
                  Salida
                </span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                {esAdmin && (
                  <Link href="/importacion" className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline">
                    <UploadCloud className="h-3.5 w-3.5" /> Lote de entrega administrativo
                  </Link>
                )}
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
          <CardContent>
            {tab === 'usb' ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') escanear(query);
                  }}
                  placeholder="Escanea aquí"
                  className="pl-9 pr-9 font-mono"
                  autoFocus
                  // Nunca se deshabilita: un escaneo que llega mientras el
                  // anterior todavia se busca se ENCOLA (ver escanear()),
                  // nunca se descarta ni se bloquea.
                />
                {buscando && <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400 dark:text-gray-500" />}
              </div>
            ) : tab === 'camara' ? (
              <div className="mx-auto max-w-sm">
                <CameraScanner onDetect={escanear} />
              </div>
            ) : (
              <div className="mx-auto max-w-sm">
                <TecladoVirtual onDetect={escanear} />
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              Al escanear, el paquete aparece y la cuenta regresiva de entrega comienza sola — no hace falta tocar ningún botón.
            </p>
            {fase === 'ERROR' && mensajeError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{mensajeError}</p>}

            {puedeEntregaExcepcional && (
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800/60 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink dark:text-gray-100">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Entrega excepcional
                </span>
                <span
                  role="switch"
                  aria-checked={excepcionalActivo}
                  onClick={() => setExcepcionalActivo((v) => !v)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                    excepcionalActivo ? 'bg-amber-500' : 'bg-gray-200 dark:bg-gray-700'
                  )}
                >
                  <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', excepcionalActivo ? 'translate-x-6' : 'translate-x-1')} />
                </span>
              </label>
            )}
            {puedeEntregaExcepcional && excepcionalActivo && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                Activado: un código que no figure como recibido podrá entregarse igual, dejando constancia de que la recepción se omitió.
              </p>
            )}
          </CardContent>
        </Card>

        {confirmandoExcepcional && (
          <div role="alertdialog" className="animate-scale-in rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-500/10 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              ⚠️ <AlertTriangle className="h-4 w-4" /> Entrega excepcional
            </p>
            <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-300">
              El código <span className="font-mono font-semibold">{confirmandoExcepcional}</span> no existe en el sistema. Esta acción creará el
              paquete y lo marcará como entregado, dejando constancia de que la recepción se omitió.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-amber-800 dark:text-amber-300">
                Motivo de la excepción (obligatorio)
              </label>
              <input
                type="text"
                value={motivoExcepcionalInput}
                onChange={(e) => setMotivoExcepcionalInput(e.target.value)}
                placeholder="Ej: el cliente llegó sin que el paquete pasara por Recepción"
                maxLength={300}
                className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-ink dark:text-gray-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
              <label className="block text-xs font-semibold text-amber-800 dark:text-amber-300">Monto a cobrar (opcional)</label>
              <input
                type="number"
                min={0}
                step="0.5"
                value={montoExcepcionalInput}
                onChange={(e) => setMontoExcepcionalInput(e.target.value)}
                placeholder="Dejar vacío si no corresponde cobrar ahora"
                className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-ink dark:text-gray-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" onClick={cancelarExcepcional} disabled={registrandoExcepcional}>
                Cancelar
              </Button>
              <Button size="sm" onClick={confirmarExcepcional} loading={registrandoExcepcional} disabled={!motivoExcepcionalInput.trim()}>
                Confirmar entrega
              </Button>
            </div>
          </div>
        )}

        {alertaEntregado && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-xl border-2 border-red-700 bg-red-600 px-4 py-3.5 text-white shadow-lg"
          >
            <AlertTriangle className="h-7 w-7 shrink-0" strokeWidth={2.25} />
            <div className="min-w-0">
              <p className="text-base font-extrabold uppercase leading-tight tracking-wide">Paquete ya entregado</p>
              <p className="truncate text-sm font-medium text-red-50">
                {alertaEntregado.code} — Entregado el {fmtFecha(alertaEntregado.entregaAt)} a las {fmtHora(alertaEntregado.entregaAt)}
              </p>
            </div>
          </div>
        )}

        {feedback && (
          // Identidad de Entrega: la confirmacion positiva usa el tono
          // rojo/rosa controlado del modulo ("salida"), no el verde que usa
          // Recepcion para "entrada" — a proposito distinto de esa pantalla
          // aunque ambos sean "exito" (ver seccion "Entrega -
          // microinteracciones" de la especificacion).
          <div
            className={cn(
              'animate-fade-in-up flex items-center gap-2 rounded-xl border p-3 text-sm',
              feedback.ok
                ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400'
                : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
            )}
          >
            {feedback.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {feedback.mensaje}
          </div>
        )}

        {paquete && (
          <Card>
            <CardContent className="space-y-5 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">CÓDIGO DEL PAQUETE</p>
                  <p className="font-mono text-3xl font-bold text-ink dark:text-gray-100">{paquete.code}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={paquete.status} />
                  {paquete.origenEntrega === 'IMPORTACION' && (
                    <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-ink-soft dark:text-gray-400">
                      Importación administrativa{paquete.lote ? ` · ${paquete.lote}` : ''}
                    </span>
                  )}
                  {paquete.origenEntrega === 'EXCEPCIONAL' && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-2.5 w-2.5" /> Entrega excepcional
                    </span>
                  )}
                </div>
              </div>

              {/* Fecha/hora de ingreso, protagonista (seccion 5 de la
                  especificacion): antes solo vivia como un dato chico mas
                  dentro de la grilla de 4 columnas de abajo (que sigue
                  existiendo intacta, ver mas abajo) — el operador debe
                  poder ver de un vistazo, sin leer letra chica, cuando
                  entro el paquete y cuantos dias lleva. */}
              <div className="rounded-xl border-2 border-brand-200 dark:border-brand-900/40 bg-brand-50/70 dark:bg-brand-500/10 px-4 py-3.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                  <Calendar className="h-3.5 w-3.5" /> Dejado el
                </p>
                <p className="mt-1 text-2xl font-extrabold leading-none text-brand-700 dark:text-brand-300 sm:text-3xl">
                  {fmtFechaHoraGrande(paquete.ingresoAt)}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-brand-700 dark:text-brand-400">
                  <Clock className="h-3.5 w-3.5" /> {paquete.dias} {paquete.dias === 1 ? 'DÍA' : 'DÍAS'} EN PAQUETERÍA
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <Calendar className="h-3.5 w-3.5" /> Ingreso
                  </p>
                  <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFecha(paquete.ingresoAt)}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <Clock className="h-3.5 w-3.5" /> Días
                  </p>
                  <p className="text-sm font-medium text-ink dark:text-gray-100">{paquete.dias}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <Wallet className="h-3.5 w-3.5" /> Tarifa acordada
                  </p>
                  <p className="text-sm font-medium text-ink dark:text-gray-100">
                    {paquete.moneda} {paquete.costoAcumulado.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Entrega</p>
                  <p className="text-sm font-medium text-ink dark:text-gray-100">{fmtFecha(paquete.entregaAt)}</p>
                </div>
              </div>

              {paquete.descripcion && (
                <p className="text-sm text-ink-soft dark:text-gray-400">
                  <span className="font-medium text-ink dark:text-gray-100">Contenido: </span>
                  {paquete.descripcion}
                </p>
              )}

              {!esFinal && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Total a cobrar</p>
                      <p className={montoCobrar > 0 ? 'text-4xl font-bold text-ink dark:text-gray-100' : 'text-4xl font-bold text-emerald-600 dark:text-emerald-400'}>
                        {paquete.moneda} {montoCobrar.toFixed(2)}
                      </p>
                    </div>
                    <Badge variant={ESTADO_PAGO_VARIANT[paquete.estadoPago] ?? 'neutral'}>{ESTADO_PAGO_LABEL[paquete.estadoPago] ?? paquete.estadoPago}</Badge>
                  </div>

                  {/* Total/Pagado/Pendiente siempre visibles cuando hay algo pagado antes (anticipo o pago parcial) — no depende de abrir "Personalizar". */}
                  {paquete.montoPagado > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft dark:text-gray-400">
                      <span>
                        Tarifa acordada: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.costoAcumulado.toFixed(2)}</span>
                      </span>
                      <span>
                        Pagado: <span className="font-medium text-emerald-600 dark:text-emerald-400">{paquete.moneda} {paquete.montoPagado.toFixed(2)}</span>
                      </span>
                      <span>
                        Pendiente: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.saldoPendiente.toFixed(2)}</span>
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setPersonalizarCobro((v) => !v)}
                    aria-label="Personalizar monto"
                    title="Personalizar monto"
                    className={cn(
                      'mt-2 flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
                      personalizarCobro
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
                        : 'border-gray-200 dark:border-gray-700 text-ink-soft dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>

                  {personalizarCobro && (
                    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        <p className="text-ink-soft dark:text-gray-400">
                          Calculado: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.costoAcumulado.toFixed(2)}</span>
                        </p>
                        <p className="text-ink-soft dark:text-gray-400">
                          Pagado antes: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.montoPagado.toFixed(2)}</span>
                        </p>
                        <p className="text-ink-soft dark:text-gray-400">
                          Saldo: <span className="font-medium text-ink dark:text-gray-100">{paquete.moneda} {paquete.saldoPendiente.toFixed(2)}</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="monto-cobrar">Monto a cobrar ahora</Label>
                          <Input
                            id="monto-cobrar"
                            type="number"
                            min={0}
                            step="0.5"
                            value={montoCobrar}
                            onChange={(e) => setMontoCobrar(Math.max(0, Number(e.target.value) || 0))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="motivo-cobro">Motivo (opcional)</Label>
                          <Input
                            id="motivo-cobro"
                            value={motivoCobro}
                            onChange={(e) => setMotivoCobro(e.target.value)}
                            placeholder="Ej: cliente frecuente"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(paquete.cliente || paquete.fotoUrl) && (
                <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-ink-soft dark:text-gray-400">
                    <Store className="h-3.5 w-3.5" /> Datos de quien dejó el paquete (registrados en Recepción)
                  </p>
                  <div className="flex flex-wrap items-start gap-4">
                    {paquete.fotoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={paquete.fotoUrl}
                        alt="Foto del paquete"
                        className="h-20 w-20 shrink-0 rounded-lg object-cover ring-1 ring-gray-200 dark:ring-gray-700"
                      />
                    )}
                    {paquete.cliente && (
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                        {paquete.cliente.nombre && (
                          <p className="text-ink dark:text-gray-100">
                            <span className="text-ink-soft dark:text-gray-400">Nombre: </span>
                            {paquete.cliente.nombre}
                          </p>
                        )}
                        {paquete.cliente.emprendimiento && (
                          <p className="text-ink dark:text-gray-100">
                            <span className="text-ink-soft dark:text-gray-400">Emprendimiento: </span>
                            {paquete.cliente.emprendimiento}
                          </p>
                        )}
                        {paquete.cliente.telefono && (
                          <p className="flex items-center gap-1 text-ink dark:text-gray-100">
                            <Phone className="h-3 w-3 text-ink-soft dark:text-gray-400" /> {paquete.cliente.telefono}
                          </p>
                        )}
                        {paquete.cliente.observaciones && (
                          <p className="text-ink dark:text-gray-100 sm:col-span-2">
                            <span className="text-ink-soft dark:text-gray-400">Obs.: </span>
                            {paquete.cliente.observaciones}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <PanelColapsable titulo="Quien recoge" icono={User} abiertoInicial={!!(destinatario || destinatarioTelefono || destinatarioObs)}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="destinatario">Nombre</Label>
                    <div className="relative">
                      <Input
                        id="destinatario"
                        value={destinatario}
                        onChange={(e) => setDestinatario(e.target.value)}
                        disabled={!puedeEditarCampos}
                        placeholder="Nombre de quien recoge"
                        className="pr-11"
                      />
                      {puedeEditarCampos && <VoiceInputButton onResult={setDestinatario} className="absolute right-1 top-1/2 -translate-y-1/2" />}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="telefono">Celular</Label>
                    <Input
                      id="telefono"
                      value={destinatarioTelefono}
                      onChange={(e) => setDestinatarioTelefono(e.target.value)}
                      disabled={!puedeEditarCampos}
                      placeholder="Celular de contacto"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="destinatario-obs">Observaciones de quien recoge</Label>
                    <div className="relative">
                      <Input
                        id="destinatario-obs"
                        value={destinatarioObs}
                        onChange={(e) => setDestinatarioObs(e.target.value)}
                        disabled={!puedeEditarCampos}
                        placeholder="Ej: solo entregar con cédula"
                        className="pr-11"
                      />
                      {puedeEditarCampos && <VoiceInputButton onResult={setDestinatarioObs} className="absolute right-1 top-1/2 -translate-y-1/2" />}
                    </div>
                  </div>
                </div>
              </PanelColapsable>

              <PanelColapsable titulo="Observaciones" icono={FileTextIcon} abiertoInicial={!!obs}>
                <div className="relative">
                  <textarea
                    id="observaciones"
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    rows={2}
                    disabled={!puedeEditarCampos}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 pr-11 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:opacity-50"
                    placeholder="Ej: cliente llamó, cobrar monto especial, paquete frágil…"
                  />
                  {puedeEditarCampos && <VoiceInputButton onResult={setObs} className="absolute right-1 top-1.5" />}
                </div>
              </PanelColapsable>

              {puedeReingresar && !editandoEntregado && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditandoEntregado(true)} className="min-h-[44px]">
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={accionEnCurso}
                    onClick={() => {
                      if (window.confirm(`¿Confirmas volver a ingresar el paquete ${paquete.code}? Volverá a "En Paquetería" — no se crea un paquete nuevo ni cambia su fecha original de ingreso.`)) {
                        ejecutarAccion('reingresar', 'Paquete vuelto a ingresar. Ahora está en paquetería.', 'ok');
                      }
                    }}
                    className="min-h-[44px]"
                  >
                    <RotateCcw className="h-4 w-4" /> Volver a ingresar
                  </Button>
                </div>
              )}

              {puedeEditarCampos && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={guardarDatos} loading={accionEnCurso} className="min-h-[44px]">
                    <Save className="h-4 w-4" /> {editandoEntregado ? 'Guardar cambios' : 'Guardar datos'}
                  </Button>
                  {editandoEntregado && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // Descarta cualquier cambio sin guardar, volviendo a
                        // los valores reales del paquete antes de cerrar.
                        setObs(paquete.observaciones ?? '');
                        setDestinatario(paquete.destinatario ?? '');
                        setDestinatarioTelefono(paquete.destinatarioTelefono ?? '');
                        setDestinatarioObs(paquete.destinatarioObservaciones ?? '');
                        setEditandoEntregado(false);
                      }}
                      className="min-h-[44px]"
                    >
                      <X className="h-4 w-4" /> Cancelar
                    </Button>
                  )}
                </div>
              )}

              {MOTIVO_NO_ENTREGABLE[paquete.status] && (
                <p className="rounded-lg bg-brand-50 dark:bg-brand-500/10 p-3 text-sm text-brand-700 dark:text-brand-400">
                  {MOTIVO_NO_ENTREGABLE[paquete.status]}
                </p>
              )}

              <div className="flex flex-wrap gap-3 border-t border-gray-100 dark:border-gray-800/60 pt-4">
                {puedeEntregar && fase !== 'COUNTDOWN' && fase !== 'DELIVERING' && (
                  <Button size="lg" variant="secondary" onClick={() => setFase('COUNTDOWN')} disabled={accionEnCurso} className="flex-1 sm:flex-none">
                    <Truck className="h-5 w-5" /> Entregar manualmente
                  </Button>
                )}
                {puedeEnviarDeposito && (
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => ejecutarAccion('enviar-deposito', 'Paquete enviado a depósito.', 'deposito')}
                    disabled={accionEnCurso}
                    className="flex-1 sm:flex-none"
                  >
                    <Archive className="h-5 w-5" /> Enviar a depósito
                  </Button>
                )}
                {puedeSolicitarBajar && (
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => ejecutarAccion('solicitar-bajar', 'Se solicitó bajar el paquete de depósito.', 'deposito')}
                    disabled={accionEnCurso}
                    className="flex-1 sm:flex-none"
                  >
                    <ArrowDownToLine className="h-5 w-5" /> Solicitar bajar de depósito
                  </Button>
                )}
                {puedeDenegar && (
                  <Button
                    size="lg"
                    variant="destructive"
                    disabled={accionEnCurso}
                    onClick={() => {
                      if (window.confirm(`¿Confirmas denegar el paquete ${paquete.code}? Esta acción no se puede deshacer.`)) {
                        ejecutarAccion('denegar', 'Paquete denegado.', 'error');
                      }
                    }}
                  >
                    <Ban className="h-5 w-5" /> Denegar
                  </Button>
                )}
              </div>

              {esFinal && (
                <Button variant="ghost" size="sm" onClick={nuevaBusqueda}>
                  Buscar otro paquete
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!paquete && fase !== 'ERROR' && (
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-3 text-gray-400 dark:text-gray-500">
            <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <p className="text-sm">Escanea o busca un código para ver los detalles del paquete.</p>
          </div>
        )}

      </div>

      {/* Columna derecha: en desktop no debe quedar vacia debajo del stat —
          "Entregados recientemente" vive aqui (antes quedaba en la columna
          izquierda y la derecha era solo una tarjeta con mucho espacio en
          blanco debajo). */}
      <div className="space-y-5">
        <Card className="border-rose-100 dark:border-rose-900/40">
          <CardContent className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500 text-white">
              <Truck className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-ink-soft dark:text-gray-400">Entregados hoy</p>
              <p className="text-2xl font-semibold text-ink dark:text-gray-100">{entregadosHoy}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" /> Entregados recientemente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entregadosRecientes.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">Todavía no se entregó ningún paquete hoy.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {entregadosRecientes.map((p) => (
                  <div key={p.code} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono font-semibold text-ink dark:text-gray-100">{p.code}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{fmtHora(p.entregaAt)}</span>
                        <span className="text-ink-soft dark:text-gray-400">
                          {moneda} {p.montoPagado.toFixed(2)}
                        </span>
                        <Badge variant={ESTADO_PAGO_VARIANT[p.estadoPago] ?? 'neutral'}>{ESTADO_PAGO_LABEL[p.estadoPago] ?? p.estadoPago}</Badge>
                      </div>
                      {esAdmin && (
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => (editando === p.code ? setEditando(null) : abrirEdicion(p))}
                            className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            {editando === p.code ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                            {editando === p.code ? 'Cerrar' : 'Editar'}
                          </button>
                          <button
                            type="button"
                            disabled={reingresandoCode === p.code}
                            onClick={() => {
                              if (window.confirm(`¿Confirmas volver a ingresar el paquete ${p.code}? Volverá a "En Paquetería" — no se crea un paquete nuevo ni cambia su fecha original de ingreso.`)) {
                                reingresarDesdeLista(p.code);
                              }
                            }}
                            className="flex items-center gap-1 text-xs text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Volver a ingresar
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft dark:text-gray-400">
                      {p.destinatario && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {p.destinatario}
                        </span>
                      )}
                      <span>
                        {p.origenEntrega === 'IMPORTACION'
                          ? `Importación administrativa${p.lote ? ` · ${p.lote}` : ''}`
                          : p.origenEntrega === 'EXCEPCIONAL'
                            ? 'Entrega excepcional'
                            : 'Recepción'}
                      </span>
                    </div>
                    {editando === p.code && (
                      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                        <p className="w-full text-xs text-ink-soft dark:text-gray-400">
                          Monto anterior: <span className="font-medium text-ink dark:text-gray-100">{moneda} {editMontoAnterior.toFixed(2)}</span>
                        </p>
                        <div className="space-y-1">
                          <Label htmlFor={`edit-monto-${p.code}`}>Nuevo monto</Label>
                          <Input
                            id={`edit-monto-${p.code}`}
                            type="number"
                            min={0}
                            step="0.5"
                            value={editMonto}
                            onChange={(e) => setEditMonto(Math.max(0, Number(e.target.value) || 0))}
                            className="w-32"
                          />
                        </div>
                        <div className="min-w-[160px] flex-1 space-y-1">
                          <Label htmlFor={`edit-motivo-${p.code}`}>Motivo (opcional)</Label>
                          <Input id={`edit-motivo-${p.code}`} value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} placeholder="Ej: se cobró de más por error" />
                        </div>
                        <Button size="sm" onClick={() => guardarCorreccion(p.code)} loading={guardandoCorreccion} className="min-h-[44px]">
                          Guardar corrección
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(fase === 'COUNTDOWN' || fase === 'DELIVERING') && paquete && paquete.status === 'EN_PAQUETERIA' && (
        <DeliveryCountdown
          // key=code: si el operador escanea un paquete distinto mientras
          // la cuenta regresiva del anterior seguia corriendo, esto fuerza
          // a React a desmontar la cuenta vieja (cancela su temporizador)
          // y montar una nueva completa para el paquete actual. En la
          // practica esto ya no compite consigo mismo: la cola FIFO (ver
          // procesarEntrega) no deja que un segundo codigo llegue a este
          // punto hasta que el ciclo del primero termina — este key sigue
          // siendo la red de seguridad correcta de todos modos.
          key={paquete.code}
          code={paquete.code}
          seconds={countdownSegundos}
          moneda={paquete.moneda}
          monto={montoCobrar}
          tarifaAcordada={paquete.costoAcumulado}
          estadoPago={paquete.estadoPago}
          onConfirm={confirmarEntregaDesdeCountdown}
          onCancel={cancelarCountdown}
        />
      )}
    </div>
  );
}
