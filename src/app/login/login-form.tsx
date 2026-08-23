'use client';

// src/app/login/login-form.tsx
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { moduloInicialPara, type Role } from '@/types';

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      // El servidor siempre responde JSON (ver /api/auth/login), pero un
      // 502/503 real del proxy o un corte de red a mitad de respuesta no
      // lo son — sin este catch, res.json() lanzaba "Unexpected end of
      // JSON input" en vez de un mensaje entendible.
      const data = await res.json().catch(() => null);
      if (!res.ok || data === null) {
        throw new Error((data && data.error) || 'No se pudo iniciar sesión. Intenta de nuevo en unos segundos.');
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      const destinoRol = moduloInicialPara(data.user.role as Role);
      router.push(next && next.startsWith('/') ? next : `/${destinoRol ?? 'login'}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username">Usuario</Label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            id="username"
            autoFocus
            autoComplete="username"
            className="pl-9"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="pl-9"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Ingresar
      </Button>
    </form>
  );
}
