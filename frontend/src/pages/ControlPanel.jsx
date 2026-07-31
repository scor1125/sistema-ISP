import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Kpi } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Users, UserX, Sparkles, DollarSign, Router as RouterIcon, Radio, Calendar } from "lucide-react";

const AXIS = "hsl(240 5% 55%)";
const GRID = "hsl(240 10% 15%)";
const PRIMARY = "hsl(var(--primary))";
const TT = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

export default function ControlPanel() {
  const [d, setD] = useState(null);
  useEffect(() => {
    (async () => {
      try { setD((await api.get("/stats/dashboard")).data); }
      catch (err) { console.error("[ControlPanel] load failed:", err); }
    })();
  }, []);

  const monthly = d?.monthly_revenue || [];
  const recent = d?.recent_payments || [];
  const mikrotiks = d?.mikrotiks || [];
  const olts = d?.olts || [];

  return (
    <div>
      <PageHeader title="Panel de control" subtitle="Vista consolidada de la operación: clientes, ingresos, calendario mensual y estado de la red." />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label="Clientes totales" value={d?.total_clients ?? "—"} trend={<span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> Base activa</span>} />
        <Kpi label="Clientes activos" value={d?.active ?? "—"} tone="success" trend={<span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Con pago al día</span>} />
        <Kpi label="Clientes suspendidos" value={d?.suspended ?? "—"} tone="danger" trend={<span className="inline-flex items-center gap-1"><UserX className="w-3 h-3" /> Corte por pago</span>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Kpi label="Ingresos este mes" value={`$${(d?.revenue_this_month ?? 0).toLocaleString()}`} tone="success" trend={<span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> pagos registrados</span>} />
        <Kpi label="Ingresos mes anterior" value={`$${(d?.revenue_prev_month ?? 0).toLocaleString()}`} trend={<span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> comparativa</span>} />
      </div>

      <section className="mt-6 rounded-md border border-border bg-card p-5">
        <div className="flex items-baseline gap-2 mb-3">
          <Calendar className="w-4 h-4 text-primary" />
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Calendario de ingresos · últimos 12 meses</div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" stroke={AXIS} fontSize={11} />
              <YAxis stroke={AXIS} fontSize={11} />
              <Tooltip contentStyle={TT} formatter={(v) => `$${Number(v).toLocaleString()}`} />
              <Bar dataKey="amount" fill={PRIMARY} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Ingresos recientes por día, hora y responsable</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead><TableHead>Hora</TableHead><TableHead>Cliente</TableHead>
              <TableHead>Monto</TableHead><TableHead>Método</TableHead><TableHead>Registrado por</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin ingresos aún.</TableCell></TableRow>}
            {recent.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{(p.created_at || "").slice(0, 10)}</TableCell>
                <TableCell className="font-mono text-xs">{(p.created_at || "").slice(11, 16)}</TableCell>
                <TableCell>{p.client_name}</TableCell>
                <TableCell className="font-mono">${p.amount}</TableCell>
                <TableCell><Badge variant="outline">{p.method}</Badge></TableCell>
                <TableCell>{p.created_by_name || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <DevicesCard title="Mikrotiks en línea" icon={RouterIcon} devices={mikrotiks} />
        <DevicesCard title="OLTs en línea" icon={Radio} devices={olts} />
      </div>
    </div>
  );
}

function DevicesCard({ title, icon: Icon, devices }) {
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="ml-auto font-mono text-xs">{devices.length}</Badge>
      </div>
      <ul className="divide-y divide-border">
        {devices.length === 0 && <li className="p-4 text-sm text-muted-foreground">Sin registros.</li>}
        {devices.map((d) => (
          <li key={d.id} className="px-4 py-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{d.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">{d.host}{d.port ? `:${d.port}` : ""} · {d.location || "—"}</div>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase font-mono">{d.connection === "vpn" ? "VPN" : "IP pública"}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
