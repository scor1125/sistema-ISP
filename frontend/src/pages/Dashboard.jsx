import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Kpi } from "@/components/Common";
import { Users, UserPlus, UserX, WifiOff, DollarSign, Sparkles, AlertTriangle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";

// Stable chart style constants — pulled out to avoid re-creating on every render.
const CHART_MARGIN = { top: 5, right: 10, bottom: 0, left: -10 };
const TOOLTIP_STYLE = { background: "hsl(240 10% 8%)", border: "1px solid hsl(240 10% 15%)", borderRadius: 6 };
const GRID_STROKE = "hsl(240 10% 15%)";
const AXIS_STROKE = "hsl(240 5% 55%)";
const LINE_COLOR = "hsl(210 100% 55%)";
const BAR_RADIUS = [4, 4, 0, 0];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get("/stats/dashboard"), api.get("/clients")]);
      setStats(s.data);
      setClients(c.data);
    } catch (e) {
      console.error("Dashboard load failed", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const growthData = useMemo(() => {
    return clients
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .reduce((acc, c) => {
        const d = c.created_at.slice(0, 10);
        const last = acc[acc.length - 1];
        const total = (last?.total || 0) + 1;
        acc.push({ date: d, total });
        return acc;
      }, [])
      .slice(-14);
  }, [clients]);

  const statusData = useMemo(
    () => [
      { s: "Activos", v: stats?.active || 0 },
      { s: "Suspendidos", v: stats?.suspended || 0 },
      { s: "Offline", v: stats?.offline || 0 },
      { s: "Nuevos", v: stats?.new || 0 },
    ],
    [stats],
  );

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Vista general del estado de tu red y clientes." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi testId="kpi-total" label="Clientes totales" value={stats?.total_clients ?? "—"} trend={<span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> Base activa</span>} />
        <Kpi testId="kpi-active" label="Activos" value={stats?.active ?? "—"} tone="success" trend={<span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Con pago al día</span>} />
        <Kpi testId="kpi-suspended" label="Suspendidos" value={stats?.suspended ?? "—"} tone="danger" trend={<span className="inline-flex items-center gap-1"><UserX className="w-3 h-3" /> Corte por pago</span>} />
        <Kpi testId="kpi-offline" label="Fuera de línea" value={stats?.offline ?? "—"} tone="warn" trend={<span className="inline-flex items-center gap-1"><WifiOff className="w-3 h-3" /> ONU sin señal</span>} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <Kpi testId="kpi-new" label="Nuevos" value={stats?.new ?? "—"} tone="info" trend={<span className="inline-flex items-center gap-1"><UserPlus className="w-3 h-3" /> Sin activar</span>} />
        <Kpi testId="kpi-new-month" label="Alta este mes" value={stats?.new_this_month ?? "—"} />
        <Kpi testId="kpi-revenue" label="Ingresos del mes" value={`$${(stats?.revenue_this_month ?? 0).toLocaleString()}`} tone="success" trend={<span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> Pagos registrados</span>} />
        <Kpi testId="kpi-open-leads" label="Leads abiertos" value={stats?.open_leads ?? "—"} trend={<span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Requieren acción</span>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2 rounded-md border border-border bg-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Crecimiento</div>
              <h3 className="font-display text-lg font-semibold mt-1">Clientes acumulados</h3>
            </div>
            <div className="text-xs text-muted-foreground font-mono">últimos {growthData.length} días con actividad</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthData} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" stroke={AXIS_STROKE} fontSize={11} />
                <YAxis stroke={AXIS_STROKE} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="total" stroke={LINE_COLOR} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Distribución</div>
          <h3 className="font-display text-lg font-semibold mt-1 mb-3">Estado de clientes</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="s" stroke={AXIS_STROKE} fontSize={11} />
                <YAxis stroke={AXIS_STROKE} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="v" fill={LINE_COLOR} radius={BAR_RADIUS} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
