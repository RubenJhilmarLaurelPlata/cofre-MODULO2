// src/components/layout/logo.tsx
// Logo compartido por Sidebar/MobileNav/Login (Fase 4B). Dos correcciones
// reales sobre lo que habia antes:
// 1. "unoptimized" en next/image: el bug de imagen rota reportado en
//    Mac/Chrome viene de que "sharp" no esta instalado como dependencia —
//    next/image lo requiere para optimizar en produccion. El logo es un
//    activo fijo y pequeno (no necesita el pipeline de optimizacion), asi
//    que se evita esa dependencia por completo en vez de agregarla.
// 2. Usa el logo subido por el administrador en Configuracion -> Empresa
//    (Company.logoUrl) si existe; antes ese campo se guardaba pero nunca
//    se leia aqui, siempre se mostraba el archivo estatico sin importar
//    lo que el admin hubiera subido.
import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ logoUrl, size = 32, className }: { logoUrl?: string | null; size?: number; className?: string }) {
  return (
    <Image
      src={logoUrl || '/logo.jpg'}
      alt="Cofre Express"
      width={size}
      height={size}
      unoptimized
      className={cn('rounded-full object-cover ring-1 ring-white/10', className)}
      style={{ width: size, height: size }}
    />
  );
}
