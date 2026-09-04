// src/lib/nav-items.ts
import {
  LayoutDashboard,
  PackagePlus,
  Container,
  Truck,
  Archive,
  Search,
  Tags,
  FileBarChart,
  Wallet,
  UploadCloud,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Modulo } from '@/types';

// Agrupamiento del menu (Fase 4B): navegacion plana -> clusters con
// sentido operativo, para que el sidebar se lea como un producto SaaS y
// no como una lista suelta de 10 items.
export type NavGrupo = 'operacion' | 'gestion' | 'sistema';

export const NAV_GRUPO_LABELS: Record<NavGrupo, string> = {
  operacion: 'Operación',
  gestion: 'Gestión',
  sistema: 'Sistema',
};

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  modulo: Modulo;
  grupo: NavGrupo;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, modulo: 'dashboard', grupo: 'operacion' },
  { href: '/recepcion', label: 'Recepción', icon: PackagePlus, modulo: 'recepcion', grupo: 'operacion' },
  { href: '/envios', label: 'Envíos', icon: Container, modulo: 'envios', grupo: 'operacion' },
  { href: '/entrega', label: 'Entrega', icon: Truck, modulo: 'entrega', grupo: 'operacion' },
  { href: '/deposito', label: 'Depósito', icon: Archive, modulo: 'deposito', grupo: 'operacion' },
  { href: '/buscador', label: 'Buscador', icon: Search, modulo: 'buscador', grupo: 'operacion' },
  { href: '/etiquetas', label: 'Etiquetas', icon: Tags, modulo: 'etiquetas', grupo: 'gestion' },
  { href: '/reportes', label: 'Reportes', icon: FileBarChart, modulo: 'reportes', grupo: 'gestion' },
  { href: '/finanzas', label: 'Finanzas', icon: Wallet, modulo: 'finanzas', grupo: 'gestion' },
  { href: '/importacion', label: 'Importación', icon: UploadCloud, modulo: 'importacion', grupo: 'gestion' },
  { href: '/configuracion', label: 'Configuración', icon: Settings, modulo: 'configuracion', grupo: 'sistema' },
];
