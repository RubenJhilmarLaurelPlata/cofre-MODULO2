// src/lib/entrega-lote.ts
// Helper compartido por las rutas de Entrega (GET/PATCH/entregar/corregir):
// completa PackageDetailDTO.lote cuando el paquete vino de una
// importación administrativa (Fase 3). Vive en su propio archivo (no
// dentro de package-detail.ts) para evitar un ciclo de imports:
// package-transitions.ts ya importa package-detail.ts, e importacion.ts
// importa package-transitions.ts — si package-detail.ts importara
// importacion.ts para esto, se cerraría el ciclo.
import { prisma } from '@/lib/prisma';
import { getLotesPorPackageId } from '@/lib/importacion';
import type { PackageDetailDTO } from '@/lib/package-detail';

export async function conLoteImportacion<T extends PackageDetailDTO>(code: string, detalle: T): Promise<T> {
  if (detalle.origenEntrega !== 'IMPORTACION') return detalle;
  const pkg = await prisma.package.findUnique({ where: { code }, select: { id: true } });
  if (!pkg) return detalle;
  const lotes = await getLotesPorPackageId([pkg.id]);
  return { ...detalle, lote: lotes[pkg.id] ?? null };
}
