'use client';

// src/components/configuracion/usuarios-tab.tsx
import * as React from 'react';
import { Search, UserPlus, Pencil, Lock, Unlock, UserX, UserCheck, KeyRound, X, Save, CheckCircle2, XCircle, Trash2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ROLES, ROLE_LABELS, type Role } from '@/types';

interface UsuarioDTO {
  id: string;
  username: string;
  nombre: string;
  role: string;
  estado: 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO' | 'ELIMINADO';
  bloqueadoHasta: string | null;
  eliminadoAt: string | null;
  ultimoAccesoAt: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
}

const ESTADO_BADGE: Record<UsuarioDTO['estado'], { label: string; variant: 'success' | 'neutral' | 'danger' }> = {
  ACTIVO: { label: 'Activo', variant: 'success' },
  INACTIVO: { label: 'Inactivo (deshabilitado)', variant: 'neutral' },
  BLOQUEADO: { label: 'Bloqueado', variant: 'danger' },
  ELIMINADO: { label: 'Eliminado', variant: 'danger' },
};

function fmtFecha(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function UsuariosTab() {
  const [usuarios, setUsuarios] = React.useState<UsuarioDTO[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [q, setQ] = React.useState('');
  const [roleFiltro, setRoleFiltro] = React.useState('');
  const [estadoFiltro, setEstadoFiltro] = React.useState('');

  const [mostrarCrear, setMostrarCrear] = React.useState(false);
  const [nuevoForm, setNuevoForm] = React.useState({ username: '', password: '', nombre: '', role: 'RECEPCION' as Role });
  const [creando, setCreando] = React.useState(false);

  const [editandoId, setEditandoId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ nombre: '', role: 'RECEPCION' as Role });
  const [reseteandoId, setReseteandoId] = React.useState<string | null>(null);
  const [nuevaPassword, setNuevaPassword] = React.useState('');
  const [accionEnCurso, setAccionEnCurso] = React.useState<string | null>(null);

  // "Personalizar permisos" (Fase 2): excepciones puntuales sobre los
  // permisos del rol de un usuario — ver GET/PUT
  // /api/configuracion/usuarios/[id]/permisos. deRol es de solo lectura
  // (lo que YA tiene por su rol); extra/revocados son las excepciones que
  // este panel edita. El efectivo mostrado siempre se deriva de los tres,
  // nunca se guarda por separado.
  const [personalizandoId, setPersonalizandoId] = React.useState<string | null>(null);
  const [permisosCatalogo, setPermisosCatalogo] = React.useState<Array<{ key: string; modulo: string; nombre: string; descripcion: string }>>([]);
  const [gruposCatalogo, setGruposCatalogo] = React.useState<Array<{ modulo: string; label: string }>>([]);
  const [deRol, setDeRol] = React.useState<Set<string>>(new Set());
  const [extras, setExtras] = React.useState<Set<string>>(new Set());
  const [revocados, setRevocados] = React.useState<Set<string>>(new Set());
  const [guardandoPermisos, setGuardandoPermisos] = React.useState(false);

  async function abrirPermisos(id: string) {
    setPersonalizandoId(id);
    if (permisosCatalogo.length === 0) {
      const rolesRes = await fetch('/api/configuracion/roles');
      const rolesData = await rolesRes.json();
      setPermisosCatalogo(rolesData.permisos);
      setGruposCatalogo(rolesData.grupos);
    }
    const res = await fetch(`/api/configuracion/usuarios/${id}/permisos`);
    const efectivos: Array<{ key: string; deRol: boolean; extra: boolean; revocado: boolean }> = await res.json();
    setDeRol(new Set(efectivos.filter((e) => e.deRol).map((e) => e.key)));
    setExtras(new Set(efectivos.filter((e) => e.extra).map((e) => e.key)));
    setRevocados(new Set(efectivos.filter((e) => e.revocado).map((e) => e.key)));
  }

  function esEfectivo(key: string): boolean {
    return (deRol.has(key) || extras.has(key)) && !revocados.has(key);
  }

  function toggleEfectivo(key: string) {
    const activoAhora = esEfectivo(key);
    if (activoAhora) {
      // Apagarlo: si venia del rol, hay que revocarlo explicitamente; si
      // era un extra agregado, alcanza con quitarlo de extras.
      if (deRol.has(key)) setRevocados((prev) => new Set(prev).add(key));
      setExtras((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      // Prenderlo: si el rol ya lo da pero estaba revocado, alcanza con
      // quitar la revocacion; si el rol nunca lo dio, hay que agregarlo.
      if (deRol.has(key)) {
        setRevocados((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        setExtras((prev) => new Set(prev).add(key));
      }
    }
  }

  async function guardarPermisos(id: string) {
    setGuardandoPermisos(true);
    try {
      const res = await fetch(`/api/configuracion/usuarios/${id}/permisos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permisosExtra: [...extras], permisosRevocados: [...revocados] }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'No se pudieron guardar los permisos.');
        return;
      }
      setPersonalizandoId(null);
    } finally {
      setGuardandoPermisos(false);
    }
  }

  const buscar = React.useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (roleFiltro) params.set('role', roleFiltro);
      if (estadoFiltro) params.set('estado', estadoFiltro);
      const res = await fetch(`/api/configuracion/usuarios?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || data === null) {
        setError((data && data.error) || 'No se pudieron cargar los usuarios. Intenta de nuevo.');
        return;
      }
      setUsuarios(data);
    } catch {
      setError('No se pudieron cargar los usuarios. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [q, roleFiltro, estadoFiltro]);

  React.useEffect(() => {
    const t = setTimeout(buscar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, roleFiltro, estadoFiltro]);

  async function crearUsuario() {
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear el usuario.');
        return;
      }
      setUsuarios((prev) => [data, ...prev]);
      setMostrarCrear(false);
      setNuevoForm({ username: '', password: '', nombre: '', role: 'RECEPCION' });
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  function abrirEdicion(u: UsuarioDTO) {
    setEditandoId(u.id);
    setEditForm({ nombre: u.nombre, role: u.role as Role });
  }

  async function guardarEdicion(id: string) {
    setAccionEnCurso(id);
    try {
      const res = await fetch(`/api/configuracion/usuarios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === id ? data : u)));
      setEditandoId(null);
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function ejecutarAccion(id: string, accion: 'bloquear' | 'desbloquear' | 'desactivar' | 'reactivar' | 'eliminar') {
    setAccionEnCurso(id);
    setError(null);
    try {
      const res = await fetch(`/api/configuracion/usuarios/${id}/${accion}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo completar la acción.');
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === id ? data : u)));
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function guardarNuevaPassword(id: string) {
    setAccionEnCurso(id);
    try {
      const res = await fetch(`/api/configuracion/usuarios/${id}/resetear-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nuevaPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo restablecer la contraseña.');
        return;
      }
      setReseteandoId(null);
      setNuevaPassword('');
    } finally {
      setAccionEnCurso(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Usuarios</CardTitle>
            <Button size="sm" onClick={() => setMostrarCrear((v) => !v)}>
              <UserPlus className="h-3.5 w-3.5" /> Nuevo usuario
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Usuario o nombre…" className="pl-9" />
            </div>
            <select
              value={roleFiltro}
              onChange={(e) => setRoleFiltro(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Todos los roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Todos los estados</option>
              <option value="ACTIVO">Activo</option>
              <option value="INACTIVO">Inactivo</option>
              <option value="BLOQUEADO">Bloqueado</option>
              <option value="ELIMINADO">Eliminado</option>
            </select>
          </div>

          {mostrarCrear && (
            <div className="rounded-xl border border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nuevo-username">Usuario</Label>
                  <Input
                    id="nuevo-username"
                    value={nuevoForm.username}
                    onChange={(e) => setNuevoForm((f) => ({ ...f, username: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="nuevo-password">Contraseña</Label>
                  <Input
                    id="nuevo-password"
                    type="password"
                    value={nuevoForm.password}
                    onChange={(e) => setNuevoForm((f) => ({ ...f, password: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="nuevo-nombre">Nombre completo</Label>
                  <Input
                    id="nuevo-nombre"
                    value={nuevoForm.nombre}
                    onChange={(e) => setNuevoForm((f) => ({ ...f, nombre: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="nuevo-role">Rol</Label>
                  <select
                    id="nuevo-role"
                    value={nuevoForm.role}
                    onChange={(e) => setNuevoForm((f) => ({ ...f, role: e.target.value as Role }))}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={crearUsuario} loading={creando}>
                  <Save className="h-3.5 w-3.5" /> Crear usuario
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMostrarCrear(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      {cargando ? (
        <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            <p>No se pudieron cargar los usuarios.</p>
            <Button size="sm" variant="secondary" onClick={buscar}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : usuarios.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">No se encontró ningún usuario con esos filtros.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {usuarios.map((u) => (
            <Card key={u.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink dark:text-gray-100">
                      {u.nombre} <span className="font-mono text-xs font-normal text-gray-400 dark:text-gray-500">@{u.username}</span>
                    </p>
                    <p className="text-xs text-ink-soft dark:text-gray-400">{ROLE_LABELS[u.role as Role] ?? u.role}</p>
                  </div>
                  <Badge variant={ESTADO_BADGE[u.estado].variant}>{ESTADO_BADGE[u.estado].label}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <span>Último inicio de sesión: {fmtFecha(u.ultimoLoginAt)}</span>
                  <span>Último acceso: {fmtFecha(u.ultimoAccesoAt)}</span>
                </div>

                {editandoId === u.id ? (
                  <div className="grid grid-cols-1 gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3 sm:grid-cols-2">
                    <div>
                      <Label>Nombre</Label>
                      <Input value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label>Rol</Label>
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}
                        className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-ink dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button size="sm" onClick={() => guardarEdicion(u.id)} loading={accionEnCurso === u.id}>
                        <Save className="h-3.5 w-3.5" /> Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : reseteandoId === u.id ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                    <div className="flex-1">
                      <Label>Nueva contraseña</Label>
                      <Input type="password" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} className="mt-1" />
                    </div>
                    <Button size="sm" onClick={() => guardarNuevaPassword(u.id)} loading={accionEnCurso === u.id}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Guardar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReseteandoId(null);
                        setNuevaPassword('');
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : u.estado === 'ELIMINADO' ? (
                  // Terminal: un usuario eliminado no tiene mas acciones
                  // disponibles (no puede iniciar sesion, no puede
                  // reactivarse desde aqui) — su historial de operaciones
                  // sigue intacto y visible en Reportes/Auditoria con su
                  // nombre real, nunca se borro nada de eso.
                  <p className="border-t border-gray-100 dark:border-gray-800/60 pt-3 text-xs text-gray-400 dark:text-gray-500">
                    Este usuario fue eliminado. Su historial de operaciones se conserva intacto.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-800/60 pt-3">
                    <Button size="sm" variant="secondary" onClick={() => abrirEdicion(u)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReseteandoId(u.id)}>
                      <KeyRound className="h-3.5 w-3.5" /> Restablecer contraseña
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => (personalizandoId === u.id ? setPersonalizandoId(null) : abrirPermisos(u.id))}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Personalizar permisos
                    </Button>
                    {u.estado === 'BLOQUEADO' ? (
                      <Button size="sm" variant="secondary" loading={accionEnCurso === u.id} onClick={() => ejecutarAccion(u.id, 'desbloquear')}>
                        <Unlock className="h-3.5 w-3.5" /> Desbloquear
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={accionEnCurso === u.id}
                        onClick={() => window.confirm(`¿Bloquear a ${u.nombre}?`) && ejecutarAccion(u.id, 'bloquear')}
                      >
                        <Lock className="h-3.5 w-3.5" /> Bloquear
                      </Button>
                    )}
                    {u.estado === 'INACTIVO' ? (
                      <Button size="sm" variant="secondary" loading={accionEnCurso === u.id} onClick={() => ejecutarAccion(u.id, 'reactivar')}>
                        <UserCheck className="h-3.5 w-3.5" /> Reactivar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={accionEnCurso === u.id}
                        onClick={() => window.confirm(`¿Desactivar a ${u.nombre}? Podrás reactivarlo más tarde y no perderá ningún dato.`) && ejecutarAccion(u.id, 'desactivar')}
                      >
                        <UserX className="h-3.5 w-3.5" /> Desactivar
                      </Button>
                    )}
                    {/* "Eliminar" es deliberadamente distinto de "Desactivar":
                        no es reversible desde la interfaz. El historial de
                        paquetes/pagos/auditoria de este usuario NUNCA se
                        borra — solo deja de poder iniciar sesion y de
                        aparecer como usuario activo. */}
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={accionEnCurso === u.id}
                      onClick={() =>
                        window.confirm(
                          `¿Eliminar a ${u.nombre}? Ya no podrá iniciar sesión ni aparecer como usuario activo. Su historial de paquetes, pagos y auditoría se conservará intacto con su nombre. Esta acción NO se puede deshacer desde la interfaz.`
                        ) && ejecutarAccion(u.id, 'eliminar')
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </Button>
                  </div>
                )}

                {personalizandoId === u.id && (
                  <div className="space-y-4 border-t border-gray-100 dark:border-gray-800/60 pt-3">
                    <p className="text-xs text-ink-soft dark:text-gray-400">
                      PERMISO DEL ROL <ShieldCheck className="inline h-3 w-3" /> · marcado aquí = efectivo para {u.nombre}. Desmarcar un permiso que da el rol lo{' '}
                      <strong>revoca</strong> solo para este usuario; marcar uno que el rol no da lo <strong>agrega</strong> como excepción.
                    </p>
                    <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                      {gruposCatalogo.map((grupo) => {
                        const delGrupo = permisosCatalogo.filter((p) => p.modulo === grupo.modulo);
                        if (delGrupo.length === 0) return null;
                        return (
                          <div key={grupo.modulo}>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-gray-400">{grupo.label}</p>
                            <div className="space-y-0.5">
                              {delGrupo.map((p) => (
                                <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40">
                                  <input type="checkbox" className="h-4 w-4 rounded border-gray-300 dark:border-gray-700 text-brand-600" checked={esEfectivo(p.key)} onChange={() => toggleEfectivo(p.key)} />
                                  <span className="text-ink dark:text-gray-100">{p.nombre}</span>
                                  {deRol.has(p.key) && <span className="text-[10px] text-gray-400 dark:text-gray-500">(del rol)</span>}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => guardarPermisos(u.id)} loading={guardandoPermisos}>
                        <Save className="h-3.5 w-3.5" /> Guardar permisos personalizados
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPersonalizandoId(null)}>
                        Cerrar
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
