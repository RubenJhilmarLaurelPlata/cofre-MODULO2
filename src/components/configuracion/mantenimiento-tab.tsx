'use client';

// src/components/configuracion/mantenimiento-tab.tsx
// Solo lectura: informacion real del sistema, sin ninguna accion
// peligrosa disponible desde aqui.
import * as React from 'react';
import { Database, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/stat-card';

interface InfoMantenimiento {
  versionSistema: string;
  versionNext: string;
  versionPrisma: string;
  baseDeDatosConectada: boolean;
  espacioBaseDeDatosBytes: number | null;
  registros: {
    paquetes: number;
    usuarios: number;
    historialPaquetes: number;
    lotesEtiquetas: number;
    codigosGenerados: number;
    auditoria: number;
  };
  ultimoRespaldo: string | null;
  ultimaOptimizacion: string | null;
}

function fmtTamanio(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtFecha(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

export function MantenimientoTab() {
  const [info, setInfo] = React.useState<InfoMantenimiento | null>(null);

  React.useEffect(() => {
    fetch('/api/configuracion/mantenimiento')
      .then((res) => res.json())
      .then(setInfo);
  }, []);

  if (!info) return <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Cargando…</p>;

  const totalRegistros = Object.values(info.registros).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Estado del sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Versión del sistema</p>
              <p className="font-mono text-sm font-medium text-ink dark:text-gray-100">{info.versionSistema}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Next.js</p>
              <p className="font-mono text-sm font-medium text-ink dark:text-gray-100">{info.versionNext}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Prisma</p>
              <p className="font-mono text-sm font-medium text-ink dark:text-gray-100">{info.versionPrisma}</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              info.baseDeDatosConectada ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
          >
            {info.baseDeDatosConectada ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {info.baseDeDatosConectada ? 'Base de datos conectada correctamente.' : 'No se pudo conectar a la base de datos.'}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Database} label="Registros totales" value={totalRegistros.toLocaleString('es-BO')} />
        <StatCard icon={Database} label="Espacio en disco" value={fmtTamanio(info.espacioBaseDeDatosBytes)} />
        <StatCard icon={Database} label="Último respaldo" value={fmtFecha(info.ultimoRespaldo)} />
        <StatCard icon={Database} label="Última optimización" value={fmtFecha(info.ultimaOptimizacion)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registros por tabla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            ['Paquetes', info.registros.paquetes],
            ['Usuarios', info.registros.usuarios],
            ['Historial de paquetes', info.registros.historialPaquetes],
            ['Lotes de etiquetas', info.registros.lotesEtiquetas],
            ['Códigos generados', info.registros.codigosGenerados],
            ['Registros de auditoría', info.registros.auditoria],
          ].map(([label, valor]) => (
            <div key={label as string} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800/60 py-1.5 text-sm last:border-0">
              <span className="text-ink-soft dark:text-gray-400">{label}</span>
              <span className="font-medium text-ink dark:text-gray-100">{(valor as number).toLocaleString('es-BO')}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
