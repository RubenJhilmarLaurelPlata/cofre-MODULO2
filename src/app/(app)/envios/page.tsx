// src/app/(app)/envios/page.tsx
// Centro de operaciones de Envíos (Fase 2.1 — identidad visual): hero
// con la identidad de ESTA instalación (Fase 1: Company.sucursalNombre,
// misma fuente que src/lib/envios.ts:getEnvioDetalle() — nunca un valor
// hardcodeado ni una segunda fuente) + tres acciones grandes y claras.
// El elemento "vehículo" es el ícono Container de lucide-react (ya una
// dependencia del proyecto, usado también en el sidebar y en el resto
// del módulo) dibujado como marca de agua vectorial con CSS — ninguna
// imagen externa ni generada.
import Link from 'next/link';
import { Container, QrCode, ClipboardList, ChevronRight, MapPin, ArrowRight } from 'lucide-react';
import { getCompanyConfig } from '@/lib/config';

const ACCIONES = [
  {
    href: '/envios/nuevo',
    icon: Container,
    titulo: 'Enviar paquetes',
    descripcion: 'Prepara un envío hacia otra sucursal.',
    destacado: true,
  },
  {
    href: '/envios/recibir',
    icon: QrCode,
    titulo: 'Recibir envío',
    descripcion: 'Escanea el QR del lote que llegó.',
    destacado: false,
  },
  {
    href: '/envios/historial',
    icon: ClipboardList,
    titulo: 'Historial',
    descripcion: 'Consulta los movimientos realizados.',
    destacado: false,
  },
] as const;

export default async function EnviosHubPage() {
  const company = await getCompanyConfig();
  const origen = company.sucursalNombre ?? 'Esta instalación';

  return (
    <div className="space-y-6">
      {/* Hero: identidad propia de la sección — ver header del archivo. */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-brand-900 p-8 text-white shadow-sm">
        <Container className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 -rotate-12 text-white/[0.06]" strokeWidth={1} aria-hidden />
        <Container className="pointer-events-none absolute -bottom-14 right-24 h-40 w-40 rotate-6 text-brand-500/10" strokeWidth={1} aria-hidden />

        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-500/30">
            <Container className="h-6 w-6 text-brand-400" strokeWidth={1.75} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Envíos</h1>
          <p className="mt-1 max-w-md text-sm text-gray-300">Prepara y recibe paquetes que viajan entre sucursales.</p>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-200 ring-1 ring-white/10">
            <MapPin className="h-3.5 w-3.5 text-brand-400" />
            {origen}
            <ArrowRight className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-gray-400">otra sucursal</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACCIONES.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={
              a.destacado
                ? 'group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-brand-500 bg-brand-500 p-6 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-lg'
                : 'group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm transition-transform hover:-translate-y-0.5 hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-lg'
            }
          >
            <a.icon
              className={a.destacado ? 'pointer-events-none absolute -bottom-6 -right-6 h-28 w-28 text-white/10' : 'pointer-events-none absolute -bottom-6 -right-6 h-28 w-28 text-brand-500/[0.07] dark:text-brand-500/10'}
              strokeWidth={1}
              aria-hidden
            />
            <div className="relative">
              <a.icon className={a.destacado ? 'h-9 w-9' : 'h-9 w-9 text-brand-500'} strokeWidth={1.75} />
              <h2 className={a.destacado ? 'mt-4 text-lg font-semibold' : 'mt-4 text-lg font-semibold text-ink dark:text-gray-100'}>{a.titulo}</h2>
              <p className={a.destacado ? 'mt-1 text-sm text-white/90' : 'mt-1 text-sm text-ink-soft dark:text-gray-400'}>{a.descripcion}</p>
            </div>
            <div className={a.destacado ? 'relative mt-5 flex items-center gap-1 text-sm font-medium' : 'relative mt-5 flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400'}>
              Continuar
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
