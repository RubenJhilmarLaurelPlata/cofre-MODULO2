'use client';

// src/components/configuracion/roles-permisos-tab.tsx
// Ya NO es informativo: cada checkbox persiste en RolePermiso via
// PUT /api/configuracion/roles/[role]/permisos (ver ese archivo) — deja
// de depender de un Record hardcodeado en TypeScript.
import * as React from 'react';
import { CheckCircle2, XCircle, ShieldCheck, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ROLES, ROLE_LABELS, type Role } from '@/types';

interface PermisoDef {
  key: string;
  modulo: string;
  nombre: string;
  descripcion: string;
}
interface GrupoDef {
  modulo: string;
  label: string;
}
interface RolConPermisos {
  role: Role;
  label: string;
  permisos: string[];
}

export function RolesPermisosTab() {
  const [grupos, setGrupos] = React.useState<GrupoDef[]>([]);
  const [permisos, setPermisos] = React.useState<PermisoDef[]>([]);
  const [roles, setRoles] = React.useState<RolConPermisos[]>([]);
  const [rolActivo, setRolActivo] = React.useState<Role>('ADMIN');
  const [seleccion, setSeleccion] = React.useState<Set<string>>(new Set());
  const [cargando, setCargando] = React.useState(true);
  const [guardando, setGuardando] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; mensaje: string } | null>(null);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/configuracion/roles');
      const data = await res.json();
      setGrupos(data.grupos);
      setPermisos(data.permisos);
      setRoles(data.roles);
      const rol = data.roles.find((r: RolConPermisos) => r.role === rolActivo) ?? data.roles[0];
      setSeleccion(new Set<string>(rol?.permisos ?? []));
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  function cambiarRol(role: Role) {
    setRolActivo(role);
    setFeedback(null);
    const rol = roles.find((r) => r.role === role);
    setSeleccion(new Set<string>(rol?.permisos ?? []));
  }

  function toggle(key: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function guardar() {
    setGuardando(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/configuracion/roles/${rolActivo}/permisos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permisos: [...seleccion] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, mensaje: data.error ?? 'No se pudo guardar.' });
        return;
      }
      setRoles((prev) => prev.map((r) => (r.role === rolActivo ? { ...r, permisos: [...seleccion] } : r)));
      setFeedback({ ok: true, mensaje: `Permisos de ${ROLE_LABELS[rolActivo]} actualizados.` });
    } catch {
      setFeedback({ ok: false, mensaje: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Roles y permisos</CardTitle>
          {feedback && (
            <span className={cn('flex items-center gap-1 text-xs', feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {feedback.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {feedback.mensaje}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          {ROLES.map((role) => (
            <button
              key={role}
              onClick={() => cambiarRol(role)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                rolActivo === role ? 'bg-white dark:bg-gray-900 text-ink dark:text-gray-100 shadow-sm' : 'text-ink-soft dark:text-gray-400 hover:text-ink dark:hover:text-gray-100'
              )}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>

        <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Marca lo que puede hacer <strong className="text-ink dark:text-gray-200">{ROLE_LABELS[rolActivo]}</strong>. Los cambios se aplican de inmediato, sin reiniciar el sistema.
        </p>

        <div className="space-y-5">
          {grupos.map((grupo) => {
            const delGrupo = permisos.filter((p) => p.modulo === grupo.modulo);
            if (delGrupo.length === 0) return null;
            return (
              <div key={grupo.modulo}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-gray-400">{grupo.label}</p>
                <div className="space-y-1 rounded-lg border border-gray-100 dark:border-gray-800/60 p-2">
                  {delGrupo.map((p) => (
                    <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 dark:border-gray-700 text-brand-600 focus:ring-brand-500"
                        checked={seleccion.has(p.key)}
                        onChange={() => toggle(p.key)}
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink dark:text-gray-100">{p.nombre}</span>
                        <span className="block text-xs text-gray-400 dark:text-gray-500">{p.descripcion}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Button onClick={guardar} loading={guardando}>
          <Save className="h-4 w-4" /> Guardar permisos de {ROLE_LABELS[rolActivo]}
        </Button>
      </CardContent>
    </Card>
  );
}
