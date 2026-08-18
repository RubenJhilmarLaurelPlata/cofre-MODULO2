'use client';

// src/components/dashboard/live-header.tsx
// Encabezado del Dashboard: dia/fecha/hora en vivo (nunca hardcodeados) +
// clima real si la empresa configuro coordenadas (ver src/lib/clima.ts).
// La hora se actualiza sola, alineada al cambio de minuto (no cada
// segundo) para no forzar renders innecesarios — coherente con la
// prioridad de rendimiento de este paso.
import * as React from 'react';
import Link from 'next/link';
import { Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, CloudOff } from 'lucide-react';

const ICONO_POR_DESCRIPCION: Record<string, typeof Sun> = {
  Despejado: Sun,
  'Parcialmente nublado': CloudSun,
  Nublado: Cloud,
  Neblina: CloudFog,
  Llovizna: CloudDrizzle,
  Lluvia: CloudRain,
  Nieve: CloudSnow,
  Tormenta: CloudLightning,
  Variable: Cloud,
};

function formatearFechaHora(d: Date): { diaFecha: string; hora: string } {
  const diaFecha = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const hora = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' }).format(d);
  return { diaFecha: diaFecha.charAt(0).toUpperCase() + diaFecha.slice(1), hora };
}

interface ClimaState {
  configurado: boolean;
  tempC?: number;
  descripcion?: string;
}

export function LiveHeader() {
  const [ahora, setAhora] = React.useState<Date | null>(null);
  const [clima, setClima] = React.useState<ClimaState | null>(null);

  React.useEffect(() => {
    setAhora(new Date());
    let timeoutId: ReturnType<typeof setTimeout>;
    function programarSiguienteMinuto() {
      const ahoraLocal = new Date();
      const msHastaSiguienteMinuto = 60_000 - (ahoraLocal.getSeconds() * 1000 + ahoraLocal.getMilliseconds());
      timeoutId = setTimeout(() => {
        setAhora(new Date());
        programarSiguienteMinuto();
      }, msHastaSiguienteMinuto);
    }
    programarSiguienteMinuto();
    return () => clearTimeout(timeoutId);
  }, []);

  React.useEffect(() => {
    let cancelado = false;
    function cargarClima() {
      fetch('/api/dashboard/clima')
        .then((r) => r.json())
        .then((data) => {
          if (cancelado) return;
          if (!data.configurado) {
            setClima({ configurado: false });
          } else if (data.clima) {
            setClima({ configurado: true, tempC: data.clima.tempC, descripcion: data.clima.descripcion });
          } else {
            setClima({ configurado: true }); // configurado pero la consulta al servicio externo falló
          }
        })
        .catch(() => {
          if (!cancelado) setClima({ configurado: true });
        });
    }
    cargarClima();
    const intervalo = setInterval(cargarClima, 10 * 60 * 1000);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  // Primer render (servidor / antes del efecto): sin hora todavia, para
  // no mostrar una hora del servidor que no coincida con la del cliente.
  if (!ahora) {
    return <div className="h-5" />;
  }

  const { diaFecha, hora } = formatearFechaHora(ahora);
  const Icono = clima?.descripcion ? ICONO_POR_DESCRIPCION[clima.descripcion] ?? Cloud : CloudOff;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft dark:text-gray-400">
      <span className="font-medium text-ink dark:text-gray-100">{diaFecha}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{hora}</span>
      <span aria-hidden>·</span>
      {clima === null ? (
        <span className="text-gray-400 dark:text-gray-500">Cargando clima…</span>
      ) : !clima.configurado ? (
        <Link href="/configuracion" className="flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">
          <CloudOff className="h-4 w-4" /> Configurar clima →
        </Link>
      ) : clima.tempC === undefined ? (
        <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
          <CloudOff className="h-4 w-4" /> Clima no disponible
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Icono className="h-4 w-4" />
          {clima.descripcion} · {clima.tempC}°C
        </span>
      )}
    </div>
  );
}
