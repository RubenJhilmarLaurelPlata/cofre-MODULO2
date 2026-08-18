'use client';

// src/components/configuracion/notificaciones-tab.tsx
// Centro de notificaciones: una vista filtrada del mismo AuditLog para
// los eventos que ameritan atencion (nunca duplica el dato). Sin
// ventanas emergentes: solo esta lista.
import * as React from 'react';
import { AlertTriangle, HardDrive, Lock, KeyRound, Settings, Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AuditLogDTO {
  id: string;
  usuario: string;
  accion: string;
  modulo: string;
  createdAt: string;
}

const CONFIG_ACCION: Record<string, { label: string; icon: typeof Bell; color: string }> = {
  LOGIN_FALLIDO: { label: 'Intento de inicio de sesión fallido', icon: KeyRound, color: 'text-amber-600' },
  LOGIN_BLOQUEADO: { label: 'Intento de acceso a cuenta bloqueada', icon: Lock, color: 'text-red-600 dark:text-red-400' },
  USUARIO_BLOQUEADO: { label: 'Usuario bloqueado automáticamente por intentos fallidos', icon: Lock, color: 'text-red-600 dark:text-red-400' },
  USUARIO_BLOQUEADO_MANUAL: { label: 'Usuario bloqueado manualmente', icon: Lock, color: 'text-red-600 dark:text-red-400' },
  RESPALDO_CREADO: { label: 'Respaldo de base de datos creado', icon: HardDrive, color: 'text-emerald-600' },
  RESPALDO_ERROR: { label: 'Error al crear un respaldo', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400' },
  CONFIGURACION_EMPRESA_ACTUALIZADA: { label: 'Datos de la empresa actualizados', icon: Settings, color: 'text-blue-600' },
  TARIFAS_ACTUALIZADAS: { label: 'Tarifas actualizadas', icon: Settings, color: 'text-blue-600' },
  SEGURIDAD_ACTUALIZADA: { label: 'Configuración de seguridad actualizada', icon: Settings, color: 'text-blue-600' },
  PREFERENCIAS_ACTUALIZADAS: { label: 'Preferencias actualizadas', icon: Settings, color: 'text-blue-600' },
};

function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function NotificacionesTab() {
  const [notificaciones, setNotificaciones] = React.useState<AuditLogDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/configuracion/notificaciones')
      .then((res) => res.json())
      .then(setNotificaciones)
      .finally(() => setCargando(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificaciones del sistema</CardTitle>
      </CardHeader>
      <CardContent>
        {cargando ? (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
        ) : notificaciones.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No hay notificaciones por ahora.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {notificaciones.map((n) => {
              const cfg = CONFIG_ACCION[n.accion] ?? { label: n.accion, icon: Bell, color: 'text-gray-500' };
              const Icono = cfg.icon;
              return (
                <div key={n.id} className="flex items-center gap-3 py-3 text-sm">
                  <Icono className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink dark:text-gray-100">{cfg.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {n.usuario} · {fmtFechaHora(n.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
