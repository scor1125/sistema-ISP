import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader, Kpi, SearchBar, norm } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wifi, WifiOff, AlertTriangle, ArrowUpAZ, ArrowDownAZ, Clock, RefreshCw, MessageCircle, ChevronsUp, Waypoints,
} from "lucide-react";

const fmtDuration = (mins) => {
  const m = Math.max(0, Math.floor(mins));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h ${min}m`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
};

const SORT_OPTS = [
  { v: "status", label: "Estado (offline primero)" },
  { v: "alarm", label: "Alarmas primero" },
  { v: "duration_desc", label: "Mayor tiempo" },
  { v: "duration_asc", label: "Menor tiempo" },
  { v: "name_asc", label: "Nombre A → Z", icon: ArrowUpAZ },
  { v: "name_desc", label: "Nombre Z → A", icon: ArrowDownAZ },
  { v: "ip_asc", label: "IP ascendente" },
  { v: "ip_desc", label: "IP descendente" },
];

const ipToNumber = (ip) => (ip || "").split(".").reduce((a, o) => a * 256 + Number(o || 0), 0);

export default function OnusStatus() {
  const [data, setData] = useState({ onus: [], totals: { total: 0, online: 0, offline: 0, alarms: 0, checked_at: "" } });
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("status");
  const [filter, setFilter] = useState("all"); // all | online | offline | alarm
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/onus/status");
      setData(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [auto, load]);

  const filtered = useMemo(() => {
    let list = [...(data.onus || [])];
    if (filter === "online") list = list.filter((x) => x.online);
    if (filter === "offline") list = list.filter((x) => !x.online);
    if (filter === "alarm") list = list.filter((x) => x.alarm);
    const nq = norm(q);
    if (nq) list = list.filter((x) => norm(`${x.full_name} ${x.ip_address} ${x.onu_serial} ${x.mikrotik_server} ${x.phone}`).includes(nq));
    switch (sortBy) {
      case "name_asc":  list.sort((a, b) => a.full_name.localeCompare(b.full_name)); break;
      case "name_desc": list.sort((a, b) => b.full_name.localeCompare(a.full_name)); break;
      case "ip_asc":    list.sort((a, b) => ipToNumber(a.ip_address) - ipToNumber(b.ip_address)); break;
      case "ip_desc":   list.sort((a, b) => ipToNumber(b.ip_address) - ipToNumber(a.ip_address)); break;
      case "duration_desc": list.sort((a, b) => b.duration_minutes - a.duration_minutes); break;
      case "duration_asc":  list.sort((a, b) => a.duration_minutes - b.duration_minutes); break;
      case "alarm":     list.sort((a, b) => (b.alarm - a.alarm) || (a.online - b.online) || (b.duration_minutes - a.duration_minutes)); break;
      case "status":
      default:          list.sort((a, b) => (a.online - b.online) || (b.duration_minutes - a.duration_minutes));
    }
    return list;
  }, [data.onus, q, sortBy, filter]);

  const alarms = useMemo(() => (data.onus || []).filter((x) => x.alarm)
    .sort((a, b) => b.duration_minutes - a.duration_minutes), [data.onus]);

  return (
    <div>
      <PageHeader
        title="ONUs Online / Offline"
        subtitle="Diagrama en tiempo real de las ONUs registradas. Ordena por IP, nombre, tiempo o estado. Alarma automática si el corte supera 60 min."
        actions={
          <>
            <label className="text-xs font-mono flex items-center gap-1 cursor-pointer mr-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="onus-auto" /> Auto 20s
            </label>
            <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="onus-refresh">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refrescar
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Total ONUs" value={data.totals.total} testId="kpi-total" />
        <Kpi label="Online" value={data.totals.online} tone="success" testId="kpi-online"
          trend={<span className="inline-flex items-center gap-1"><Wifi className="w-3 h-3" /> conectadas</span>} />
        <Kpi label="Offline" value={data.totals.offline} tone="warn" testId="kpi-offline"
          trend={<span className="inline-flex items-center gap-1"><WifiOff className="w-3 h-3" /> desconectadas</span>} />
        <Kpi label="Alarmas > 60 min" value={data.totals.alarms} tone="danger" testId="kpi-alarms"
          trend={<span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> revisar</span>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Left: alarms + timings feed */}
        <aside className="rounded-md border border-border bg-card p-4 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Feed de alarmas</div>
            <Badge variant="outline" className="ml-auto text-xs">{alarms.length}</Badge>
          </div>
          {alarms.length === 0 && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              Sin alarmas activas. Todo saludable.
            </div>
          )}
          <ul className="space-y-2">
            {alarms.map((o) => (
              <li key={o.client_id} className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-center gap-1.5">
                  <ChevronsUp className="w-3.5 h-3.5 text-red-400" />
                  <div className="text-sm font-medium truncate">{o.full_name}</div>
                </div>
                <div className="text-[11px] font-mono text-muted-foreground truncate">{o.ip_address} · {o.onu_serial}</div>
                <div className="mt-1 flex items-center gap-1 text-xs">
                  <Clock className="w-3 h-3 text-red-400" />
                  <span className="text-red-400 font-mono">{fmtDuration(o.duration_minutes)}</span>
                  <span className="text-muted-foreground">sin conexión</span>
                </div>
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                    onClick={() => nav(`/whatsapp?client=${o.client_id}`)}>
                    <MessageCircle className="w-3 h-3 mr-1" /> WhatsApp
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                    onClick={() => nav(`/clientes?focus=${o.client_id}`)}>Ver cliente</Button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* Right: diagram */}
        <section>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList data-testid="onus-filter-tabs">
                <TabsTrigger value="all">Todas</TabsTrigger>
                <TabsTrigger value="online">Online</TabsTrigger>
                <TabsTrigger value="offline">Offline</TabsTrigger>
                <TabsTrigger value="alarm">Alarmas</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-mono">Ordenar por</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-52" data-testid="onus-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SORT_OPTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <SearchBar value={q} onChange={setQ} placeholder="Buscar ONU por cliente, IP, serial o servidor…"
            hint={`${filtered.length} / ${data.onus.length}`} testId="onus-search" />

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="onus-diagram">
            {filtered.length === 0 && (
              <div className="col-span-full rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Sin ONUs que coincidan.
              </div>
            )}
            {filtered.map((o) => (
              <div key={o.client_id}
                data-testid={`onu-${o.client_id}`}
                className={`rounded-md border p-3 transition-colors relative
                  ${o.alarm ? "border-red-500/40 bg-red-500/5"
                    : o.online ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/30 bg-amber-500/5"}`}
              >
                <div className="flex items-center gap-1.5">
                  {o.online
                    ? <Wifi className="w-4 h-4 text-emerald-400" />
                    : <WifiOff className="w-4 h-4 text-amber-400" />}
                  <div className="font-medium text-sm truncate flex-1">{o.full_name}</div>
                  {o.alarm && (
                    <Badge variant="outline" className="border-red-500/40 text-red-400 bg-red-500/10 text-[10px] font-mono">
                      <AlertTriangle className="w-3 h-3 mr-1" /> Alarma
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-[11px] font-mono text-muted-foreground truncate">
                  <Waypoints className="w-3 h-3 inline mr-1" />
                  {o.ip_address} · {o.onu_serial}
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs">
                  <Clock className="w-3 h-3" />
                  <span className={`font-mono ${o.online ? "text-emerald-300" : "text-amber-300"}`}>
                    {fmtDuration(o.duration_minutes)}
                  </span>
                  <span className="text-muted-foreground">
                    {o.online ? "conectada" : "sin conexión"}
                  </span>
                </div>
                <div className="mt-2 text-[10px] font-mono text-muted-foreground truncate">
                  Servidor: {o.mikrotik_server}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
