'use client';

// src/components/configuracion/configuracion-client.tsx
import * as React from 'react';
import {
  Building2,
  Users,
  ShieldCheck,
  Wallet,
  CalendarDays,
  Type,
  Tags,
  HardDrive,
  Sliders,
  Lock,
  ClipboardList,
  Bell,
  Activity,
  ScanLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmpresaTab } from '@/components/configuracion/empresa-tab';
import { UsuariosTab } from '@/components/configuracion/usuarios-tab';
import { RolesPermisosTab } from '@/components/configuracion/roles-permisos-tab';
import { TarifasTab } from '@/components/configuracion/tarifas-tab';
import { LectorTab } from '@/components/configuracion/lector-tab';
import { FeriadosTab } from '@/components/configuracion/feriados-tab';
import { MesesTab } from '@/components/configuracion/meses-tab';
import { TiposCodigoTab } from '@/components/configuracion/tipos-codigo-tab';
import { RespaldosTab } from '@/components/configuracion/respaldos-tab';
import { PreferenciasTab } from '@/components/configuracion/preferencias-tab';
import { SeguridadTab } from '@/components/configuracion/seguridad-tab';
import { AuditoriaTab } from '@/components/configuracion/auditoria-tab';
import { NotificacionesTab } from '@/components/configuracion/notificaciones-tab';
import { MantenimientoTab } from '@/components/configuracion/mantenimiento-tab';

type TabId =
  | 'empresa'
  | 'usuarios'
  | 'roles'
  | 'tarifas'
  | 'lector'
  | 'feriados'
  | 'meses'
  | 'tipos-codigo'
  | 'respaldos'
  | 'preferencias'
  | 'seguridad'
  | 'auditoria'
  | 'notificaciones'
  | 'mantenimiento';

const TABS: Array<{ id: TabId; label: string; icon: typeof Building2 }> = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'usuarios', label: 'Usuarios', icon: Users },
  { id: 'roles', label: 'Roles y permisos', icon: ShieldCheck },
  { id: 'tarifas', label: 'Tarifas', icon: Wallet },
  { id: 'lector', label: 'Lector S700', icon: ScanLine },
  { id: 'feriados', label: 'Feriados', icon: CalendarDays },
  { id: 'meses', label: 'Meses', icon: Type },
  { id: 'tipos-codigo', label: 'Tipos de código', icon: Tags },
  { id: 'respaldos', label: 'Respaldos', icon: HardDrive },
  { id: 'preferencias', label: 'Preferencias', icon: Sliders },
  { id: 'seguridad', label: 'Seguridad', icon: Lock },
  { id: 'auditoria', label: 'Auditoría', icon: ClipboardList },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
  { id: 'mantenimiento', label: 'Mantenimiento', icon: Activity },
];

export function ConfiguracionClient() {
  const [tab, setTab] = React.useState<TabId>('empresa');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.id ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'empresa' && <EmpresaTab />}
      {tab === 'usuarios' && <UsuariosTab />}
      {tab === 'roles' && <RolesPermisosTab />}
      {tab === 'tarifas' && <TarifasTab />}
      {tab === 'lector' && <LectorTab />}
      {tab === 'feriados' && <FeriadosTab />}
      {tab === 'meses' && <MesesTab />}
      {tab === 'tipos-codigo' && <TiposCodigoTab />}
      {tab === 'respaldos' && <RespaldosTab />}
      {tab === 'preferencias' && <PreferenciasTab />}
      {tab === 'seguridad' && <SeguridadTab />}
      {tab === 'auditoria' && <AuditoriaTab />}
      {tab === 'notificaciones' && <NotificacionesTab />}
      {tab === 'mantenimiento' && <MantenimientoTab />}
    </div>
  );
}
