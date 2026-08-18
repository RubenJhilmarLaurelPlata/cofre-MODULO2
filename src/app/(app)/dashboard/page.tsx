// src/app/(app)/dashboard/page.tsx
// Composicion Fase 4B: jerarquia real en vez de una fila de tarjetas
// identicas. "Cobrado hoy" es la unica metrica con protagonismo (banda
// destacada); Paquetes/Entregados/En paqueteria/Deposito son StatTile
// compactos. Debajo de lg la lectura es 2 columnas (movil y tablet
// comparten esa familia — leible desde 320px hasta 1023px sin quedar
// apretada ni estirada); desde lg el layout pasa a una grilla asimetrica
// de 12 columnas (rail de metricas / grafico grande / estados+finanzas),
// nunca 5 cards iguales en fila. Reutiliza 100% los datos ya calculados
// por getDashboardData()/calcularVariacion (Fase 4A) — cambio de
// composicion, no de datos.
import { PackagePlus, Truck, Wallet, Boxes, Archive, Clock, Receipt, Ban, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, StatTile } from '@/components/ui/card';
import { ChartSection } from '@/components/dashboard/chart-section';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { LiveHeader } from '@/components/dashboard/live-header';
import { getDashboardData } from '@/lib/dashboard-data';
import { calcularVariacion, type Variacion } from '@/lib/dashboard-comparacion';

export const dynamic = 'force-dynamic'; // el dashboard siempre debe reflejar datos en vivo

const ESTADOS_INFO = [
  { key: 'EN_PAQUETERIA', label: 'En paquetería', color: 'bg-blue-500' },
  { key: 'EN_DEPOSITO', label: 'En depósito', color: 'bg-amber-500' },
  { key: 'PENDIENTE_BAJAR', label: 'Pendientes de bajar', color: 'bg-brand-500' },
  { key: 'ENTREGADO', label: 'Entregados (histórico)', color: 'bg-emerald-500' },
  { key: 'DENEGADO', label: 'Denegados', color: 'bg-red-500' },
] as const;

export default async function DashboardPage() {
  const data = await getDashboardData();

  const variacionPaquetes = calcularVariacion(data.ingresadosHoy, data.ingresadosAyer);
  const variacionEntregados = calcularVariacion(data.entregadosHoy, data.entregadosAyer);
  const variacionCobradoHoy = calcularVariacion(data.cobradoHoy, data.cobradoAyer);
  const variacionSemana = calcularVariacion(data.cobradoSemana, data.cobradoSemanaAnterior);
  const variacionMes = calcularVariacion(data.cobradoMes, data.cobradoMesAnterior);

  const tiles = (
    <>
      <StatTile icon={PackagePlus} label="Paquetes hoy" value={data.ingresadosHoy} sub={<VariacionMini variacion={variacionPaquetes} />} />
      <StatTile icon={Truck} label="Entregados hoy" value={data.entregadosHoy} sub={<VariacionMini variacion={variacionEntregados} />} />
      <StatTile icon={Boxes} label="En paquetería" value={data.estados.EN_PAQUETERIA} sub={<p className="text-[11px] text-gray-400 dark:text-gray-500">Activos ahora</p>} />
      <StatTile icon={Archive} label="Depósito" value={data.estados.EN_DEPOSITO} sub={<p className="text-[11px] text-gray-400 dark:text-gray-500">Activos ahora</p>} />
    </>
  );

  const finanzasMini = (
    <>
      <FinanzaMini icon={Wallet} label="Cobrado semana" value={`${data.moneda} ${data.cobradoSemana.toFixed(2)}`} variacion={variacionSemana} labelVariacion="vs semana ant." />
      <FinanzaMini icon={Wallet} label="Cobrado mes" value={`${data.moneda} ${data.cobradoMes.toFixed(2)}`} variacion={variacionMes} labelVariacion="vs mes ant." />
      <FinanzaMini icon={Receipt} label="Gastos del mes" value={`${data.moneda} ${data.gastosMes.toFixed(2)}`} />
      <FinanzaMini icon={Ban} label="Denegados hoy" value={data.denegadosHoy} />
    </>
  );

  const estadosLista = (
    <div className="space-y-2.5">
      {ESTADOS_INFO.map((e) => (
        <div key={e.key} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-ink-soft dark:text-gray-400">
            <span className={`h-2 w-2 rounded-full ${e.color}`} />
            {e.label}
          </span>
          <span className="font-medium text-ink dark:text-gray-100">{data.estados[e.key]}</span>
        </div>
      ))}
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

      {/* Metrica protagonista — unica banda destacada, a diferencia del resto que son compactas. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 dark:border-brand-900/50 dark:bg-brand-500/10 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
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

      {/* Debajo de lg: 2 columnas, sirve igual de movil a tablet. Desde lg: rejilla asimetrica de 12 columnas. */}
      <div className="grid grid-cols-2 gap-2.5 lg:hidden">{tiles}</div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:hidden">{finanzasMini}</div>
      <Card className="lg:hidden">
        <CardHeader>
          <CardTitle>Ingresos y entregas</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartSection datosIniciales={data.ultimos7} />
        </CardContent>
      </Card>
      <Card className="lg:hidden">
        <CardHeader>
          <CardTitle>Estados de paquetes</CardTitle>
        </CardHeader>
        <CardContent>{estadosLista}</CardContent>
      </Card>

      <div className="hidden gap-4 lg:grid lg:grid-cols-12">
        <div className="col-span-3 grid grid-cols-1 gap-2.5">{tiles}</div>

        <Card className="col-span-6">
          <CardHeader>
            <CardTitle>Ingresos y entregas</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSection datosIniciales={data.ultimos7} />
          </CardContent>
        </Card>

        <div className="col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estados de paquetes</CardTitle>
            </CardHeader>
            <CardContent>{estadosLista}</CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-2.5">{finanzasMini}</div>
        </div>
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
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  variacion?: Variacion | null;
  labelVariacion?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900">
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
