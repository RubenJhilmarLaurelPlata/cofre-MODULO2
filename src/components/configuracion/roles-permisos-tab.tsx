'use client';

// src/components/configuracion/roles-permisos-tab.tsx
// Puramente informativo: muestra los 5 roles existentes y que modulos
// puede ver cada uno, leyendo directamente de PERMISOS_POR_MODULO
// (types/index.ts) — la misma fuente de verdad que usa el middleware.
// No permite modificar permisos individuales, tal como se pidio.
import { Check, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLES, ROLE_LABELS, PERMISOS_POR_MODULO, type Role } from '@/types';

const MODULO_LABELS: Record<keyof typeof PERMISOS_POR_MODULO, string> = {
  dashboard: 'Dashboard',
  recepcion: 'Recepción',
  entrega: 'Entrega',
  deposito: 'Depósito',
  buscador: 'Buscador',
  etiquetas: 'Etiquetas',
  reportes: 'Reportes',
  finanzas: 'Finanzas',
  importacion: 'Importación',
  configuracion: 'Configuración',
};

export function RolesPermisosTab() {
  const modulos = Object.keys(PERMISOS_POR_MODULO) as Array<keyof typeof PERMISOS_POR_MODULO>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Roles del sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ROLES.map((r) => (
            <div key={r} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800/60 py-2 text-sm last:border-0">
              <span className="font-medium text-ink dark:text-gray-100">{ROLE_LABELS[r]}</span>
              <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{r}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Permisos por módulo</CardTitle>
            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <Info className="h-3.5 w-3.5" /> Solo informativo
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-ink-soft dark:text-gray-400">
            Los permisos los administra el sistema y no se pueden editar individualmente desde aquí — para cambiar el rol de un usuario, ve a
            la pestaña Usuarios.
          </p>
          <div className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800/60">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40">
                  <th className="px-3 py-2 text-xs font-semibold text-ink-soft dark:text-gray-400">Módulo</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-3 py-2 text-center text-xs font-semibold text-ink-soft dark:text-gray-400">
                      {ROLE_LABELS[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {modulos.map((m) => (
                  <tr key={m}>
                    <td className="px-3 py-2 font-medium text-ink dark:text-gray-100">{MODULO_LABELS[m]}</td>
                    {ROLES.map((r) => {
                      const permitido = (PERMISOS_POR_MODULO[m] as readonly Role[]).includes(r);
                      return (
                        <td key={r} className="px-3 py-2 text-center">
                          {permitido ? <Check className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
