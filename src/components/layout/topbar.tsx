'use client';

// src/components/layout/topbar.tsx
import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileNav } from '@/components/layout/mobile-nav';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { ROLE_LABELS, type Role } from '@/types';
import { cn } from '@/lib/utils';

const TITULOS: Record<string, [string, string]> = {
  '/dashboard': ['Dashboard', 'Resumen general del negocio en tiempo real'],
  '/recepcion': ['Recepción', 'Registro rápido de paquetes entrantes'],
  '/entrega': ['Entrega', 'Buscar, entregar y denegar paquetes'],
  '/deposito': ['Depósito', 'Enviar y bajar paquetes de depósito'],
  '/buscador': ['Buscador', 'Búsqueda avanzada de paquetes'],
  '/etiquetas': ['Etiquetas', 'Generar códigos y etiquetas para imprimir'],
  '/reportes': ['Reportes', 'Analiza la operación y exporta resultados'],
  '/finanzas': ['Finanzas', 'Gastos, ingresos y cierre de caja'],
  '/importacion': ['Importación', 'Importar lotes de códigos ya procesados'],
  '/configuracion': ['Configuración', 'Empresa, tarifas, series, usuarios y respaldos'],
};

function tituloParaRuta(pathname: string): [string, string] {
  const base = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
  return TITULOS[base] ?? ['Cofre Express', ''];
}

/** Identidad visual inmediata por modulo (seccion "Diferenciar Recepcion y Entrega"): un punto de color + microcopy junto al titulo, visible incluso en el encabezado movil, para que el operador reconozca a primera vista si esta "recibiendo" (verde/entrada) o "entregando" (rojo/salida) sin tener que leer el titulo completo. */
const IDENTIDAD_POR_RUTA: Record<string, { color: string; texto: string }> = {
  '/recepcion': { color: 'bg-emerald-500', texto: 'Entrada' },
  '/entrega': { color: 'bg-rose-500', texto: 'Salida' },
};

function identidadParaRuta(pathname: string) {
  const base = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
  return IDENTIDAD_POR_RUTA[base] ?? null;
}

export function Topbar({ nombre, role, logoUrl }: { nombre: string; role: Role; logoUrl?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [title, subtitle] = tituloParaRuta(pathname);
  const identidad = identidadParaRuta(pathname);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const iniciales = nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2.5 md:px-6 md:py-3.5 print:hidden dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2.5 md:gap-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 md:hidden dark:text-gray-400 dark:hover:bg-gray-800"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <h1 className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-ink dark:text-gray-100 md:text-base">
              {title}
              {identidad && (
                <span className="flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft dark:bg-gray-800 dark:text-gray-400">
                  <span className={cn('h-1.5 w-1.5 rounded-full', identidad.color)} aria-hidden />
                  {identidad.texto}
                </span>
              )}
            </h1>
            {subtitle && <p className="hidden text-xs text-ink-soft dark:text-gray-400 lg:block">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-ink dark:text-gray-100">{nombre}</p>
            <p className="text-xs text-ink-soft dark:text-gray-400">{ROLE_LABELS[role]}</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
            {iniciales || '?'}
          </div>
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={handleLogout} disabled={loggingOut} aria-label="Cerrar sesión">
            <LogOut className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </header>

      <MobileNav role={role} logoUrl={logoUrl} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
