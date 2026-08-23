// src/app/(app)/dashboard/page.tsx
// Composicion Fase 5: cada metrica con historial diario real (Cobrado,
// Paquetes, Entregados) se dibuja tambien como grafico (sparkline/area),
// y la distribucion de estados se ve como donut ademas de lista — nunca
// un numero suelto en una caja plana. Las metricas que son solo
// snapshot (En paqueteria/Deposito, sin historico guardado en la BD) se
// quedan como numero simple a proposito: dibujarles una tendencia
// inventaria datos que el sistema no tiene. Debajo de lg la lectura es
// simple (2 columnas); desde lg, grilla asimetrica de 12 columnas.
// Reutiliza 100% los datos reales de getDashboardData()/
// calcularVariacion — nunca un valor de ejemplo.
import { PackagePlus, Truck, Wallet, Boxes, Archive, Clock, Receipt, Ban, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, StatTile } from '@/components/ui/card';
import { ChartSection } from '@/components/dashboard/chart-section';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { LiveHeader } from '@/components/dashboard/live-header';
import { MiniSparkline } from '@/components/dashboard/mini-sparkline';
import { EstadosDonut } from '@/components/dashboard/estados-donut';
import { getDashboardData } from '@/lib/dashboard-data';
import { calcularVariacion, type Variacion } from '@/lib/dashboard-comparacion';

export const dynamic = 'force-dynamic'; // el dashboard siempre debe reflejar datos en vivo

// Colores compartidos entre el punto de texto (Tailwind) y el donut de
// recharts (necesita un hex real, no puede leer variables de Tailwind) —
// mismos tonos exactos para que ambas representaciones de un mismo estado
// coincidan a simple vista.
const ESTADOS_INFO = [
  { key: 'EN_PAQUETERIA', label: 'En paquetería', color: 'bg-blue-500', hex: '#3B82F6' },
  { key: 'EN_DEPOSITO', label: 'En depósito', color: 'bg-amber-500', hex: '#F59E0B' },
  { key: 'PENDIENTE_BAJAR', label: 'Pendientes de bajar', color: 'bg-brand-500', hex: '#F2660F' },
  { key: 'ENTREGADO', label: 'Entregados (histórico)', color: 'bg-emerald-500', hex: '#10B981' },
  { key: 'DENEGADO', label: 'Denegados', color: 'bg-red-500', hex: '#EF4444' },
] as const;

export default async function DashboardPage() {
  const data = await getDashboardData();

  const variacionPaquetes = calcularVariacion(data.ingresadosHoy, data.ingresadosAyer);
  const variacionEntregados = calcularVariacion(data.entregadosHoy, data.entregadosAyer);
  const variacionCobradoHoy = calcularVariacion(data.cobradoHoy, data.cobradoAyer);
  const variacionSemana = calcularVariacion(data.cobradoSemana, data.cobradoSemanaAnterior);
  const variacionMes = calcularVariacion(data.cobradoMes, data.cobradoMesAnterior);

  // Sparklines de Paquetes/Entregados: unicas dos metricas del panel con
  // historial diario real (ver ultimos7 en getDashboardData). En
  // paqueteria/Deposito son estado actual (snapshot), no historico —
  // mostrarles una tendencia inventaria datos que el sistema no guarda,
  // asi que se quedan como numero simple.
  const tiles = (
    <>
      <StatTile
        tone="success"
        icon={PackagePlus}
        label="Paquetes hoy"
        value={data.ingresadosHoy}
        sub={<VariacionMini variacion={variacionPaquetes} />}
        chart={<MiniSparkline data={data.ultimos7.map((p) => p.ingresados)} color="#10B981" height={32} />}
        style={{ animationDelay: '0ms' }}
      />
      <StatTile
        tone="danger"
        icon={Truck}
        label="Entregados hoy"
        value={data.entregadosHoy}
        sub={<VariacionMini variacion={variacionEntregados} />}
        chart={<MiniSparkline data={data.ultimos7.map((p) => p.entregados)} color="#F43F5E" height={32} />}
        style={{ animationDelay: '40ms' }}
      />
      <StatTile tone="info" icon={Boxes} label="En paquetería" value={data.estados.EN_PAQUETERIA} sub={<p className="text-[11px] text-gray-400 dark:text-gray-500">Activos ahora</p>} style={{ animationDelay: '80ms' }} />
      <StatTile tone="warning" icon={Archive} label="Depósito" value={data.estados.EN_DEPOSITO} sub={<p className="text-[11px] text-gray-400 dark:text-gray-500">Activos ahora</p>} style={{ animationDelay: '120ms' }} />
    </>
  );

  const finanzasMini = (
    <>
      <FinanzaMini icon={Wallet} label="Cobrado semana" value={`${data.moneda} ${data.cobradoSemana.toFixed(2)}`} variacion={variacionSemana} labelVariacion="vs semana ant." delay={0} />
      <FinanzaMini icon={Wallet} label="Cobrado mes" value={`${data.moneda} ${data.cobradoMes.toFixed(2)}`} variacion={variacionMes} labelVariacion="vs mes ant." delay={40} />
      <FinanzaMini icon={Receipt} label="Gastos del mes" value={`${data.moneda} ${data.gastosMes.toFixed(2)}`} delay={80} />
      <FinanzaMini icon={Ban} label="Denegados hoy" value={data.denegadosHoy} delay={120} />
    </>
  );

  const estadosLista = (
    <div className="space-y-3">
      {/* Donut real de proporcion (mismos 5 conteos que la lista de abajo,
          solo que tambien visuales) + lista como leyenda — reemplaza la
          barra apilada plana de la version anterior por algo con
          verdadera composicion visual. */}
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <EstadosDonut size={104} segmentos={ESTADOS_INFO.map((e) => ({ key: e.key, label: e.label, value: data.estados[e.key], color: e.hex }))} />
        <div className="w-full flex-1 space-y-2">
          {ESTADOS_INFO.map((e) => (
            <div key={e.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-ink-soft dark:text-gray-400">
                <span className={`h-2 w-2 rounded-full ${e.color}`} />
                {e.label}
              </span>
              <span className="font-medium text-ink dark:text-gray-100">{data.estados[e.key]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-2.5 text-sm">
        <span className="flex items-center gap-2 font-medium text-brand-700 dark:text-brand-400">
          <Clock className="h-4 w-4" /> Si se retiran hoy
        </span>
        <span className="font-semibold text-brand-700 dark:text-brand-400">
          {data.moneda} {data.montoEstimadoSiSeRetiranHoy.toFixed(2)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <LiveHeader />

      {/* Metrica protagonista, ahora con el mismo tratamiento "grafico real"
          que el resto del panel: la linea es exactamente
          cobradoUltimos7 (Fase 5), el mismo calculo que ya usan
          cobradoHoy/cobradoAyer aplicado dia por dia — nunca decorativo. */}
      <div className="animate-fade-in-up relative overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 via-brand-50 to-white px-4 py-4 dark:border-brand-900/50 dark:from-brand-500/10 dark:via-brand-500/5 dark:to-transparent sm:px-5 sm:py-5">
        <div className="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-brand-400/10 blur-2xl dark:bg-brand-400/5" aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-[0_0_0_4px_rgba(242,102,15,0.12)]">
              <Wallet className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs font-medium text-brand-800/70 dark:text-brand-300/70">Cobrado hoy</p>
              <p className="text-2xl font-bold tracking-tight text-brand-800 dark:text-brand-300 sm:text-3xl">
                {data.moneda} {data.cobradoHoy.toFixed(2)}
              </p>
            </div>
          </div>
          <VariacionMini variacion={variacionCobradoHoy} className="text-sm" />
        </div>
        <div className="relative -mx-1 mt-2">
          <MiniSparkline data={data.cobradoUltimos7.map((p) => p.monto)} color="#F2660F" height={56} />
        </div>
        <div className="relative mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-brand-100 dark:border-brand-900/40 pt-2.5 text-xs text-brand-700/80 dark:text-brand-300/70">
          <span>
            Semana: <strong className="font-semibold text-brand-800 dark:text-brand-300">{data.moneda} {data.cobradoSemana.toFixed(2)}</strong>
          </span>
          <span>
            Mes: <strong className="font-semibold text-brand-800 dark:text-brand-300">{data.moneda} {data.cobradoMes.toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {/* Debajo de lg: 2 columnas, sirve igual de movil a tablet. Desde lg: rejilla asimetrica de 12 columnas. */}
      <div className="grid grid-cols-2 gap-2.5 lg:hidden">{tiles}</div>
      <Card className="lg:hidden">
        <CardHeader>
          <CardTitle>Distribución de estados</CardTitle>
        </CardHeader>
        <CardContent>{estadosLista}</CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:hidden">{finanzasMini}</div>
      <Card className="lg:hidden">
        <CardHeader>
          <CardTitle>Ingresos y entregas</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartSection datosIniciales={data.ultimos7} />
        </CardContent>
      </Card>

      <div className="hidden gap-4 lg:grid lg:grid-cols-12">
        <div className="col-span-4 grid grid-cols-2 gap-2.5">{tiles}</div>

        <Card className="col-span-5">
          <CardHeader>
            <CardTitle>Distribución de estados</CardTitle>
          </CardHeader>
          <CardContent>{estadosLista}</CardContent>
        </Card>

        <div className="col-span-3 grid grid-cols-1 gap-2.5">{finanzasMini}</div>

        <Card className="col-span-12">
          <CardHeader>
            <CardTitle>Ingresos y entregas</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSection datosIniciales={data.ultimos7} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actividad reciente</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentActivity items={data.actividadReciente} moneda={data.moneda} />
        </CardContent>
      </Card>
    </div>
  );
}

function VariacionMini({ variacion, className = '' }: { variacion: Variacion | null; className?: string }) {
  if (variacion === null) {
    return <p className={`text-[11px] text-gray-400 dark:text-gray-500 ${className}`}>Sin datos suficientes</p>;
  }
  const Icon = variacion.positiva ? TrendingUp : TrendingDown;
  return (
    <p className={`flex items-center gap-1 text-[11px] font-medium ${variacion.positiva ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} ${className}`}>
      <Icon className="h-3 w-3" /> {variacion.texto} vs ayer
    </p>
  );
}

function FinanzaMini({
  icon: Icon,
  label,
  value,
  variacion,
  labelVariacion,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  variacion?: Variacion | null;
  labelVariacion?: string;
  delay?: number;
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="animate-fade-in-up flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900"
    >
      <span className="flex items-center gap-1 text-[11px] font-medium text-ink-soft dark:text-gray-400">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
        {label}
      </span>
      <span className="text-base font-bold leading-tight tracking-tight text-ink dark:text-gray-100">{value}</span>
      {variacion !== undefined &&
        (variacion === null ? (
          <p className="text-[10px] text-gray-400 dark:text-gray-500">Sin datos suficientes</p>
        ) : (
          <p className={`text-[10px] font-medium ${variacion.positiva ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {variacion.texto} {labelVariacion}
          </p>
        ))}
    </div>
  );
}
