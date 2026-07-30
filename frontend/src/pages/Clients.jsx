import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, MessageCircle, DollarSign, Search, X, ArrowUpDown, Filter } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const statusMap = {
  active: { label: "Activo", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  suspended: { label: "Suspendido", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  offline: { label: "Offline", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  new: { label: "Nuevo", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
};

const SORT_OPTIONS = [
  { value: "name_asc", label: "Nombre (A → Z)" },
  { value: "name_desc", label: "Nombre (Z → A)" },
  { value: "community_asc", label: "Comunidad (A → Z)" },
  { value: "community_desc", label: "Comunidad (Z → A)" },
  { value: "ip_asc", label: "IP (menor → mayor)" },
  { value: "ip_desc", label: "IP (mayor → menor)" },
  { value: "created_desc", label: "Creación (recientes primero)" },
  { value: "created_asc", label: "Creación (antiguos primero)" },
  { value: "payment_day_asc", label: "Día de pago (1 → 28)" },
  { value: "payment_day_desc", label: "Día de pago (28 → 1)" },
];

const IP_FILTERS = [
  { value: "all", label: "IP: todas" },
  { value: "with", label: "Solo con IP" },
  { value: "without", label: "Solo sin IP" },
];

const DEFAULT_FILTERS = {
  q: "",
  status: "all",
  community: "all",
  payment_day: "all",
  ip: "all",
  from: "",
  to: "",
  sort: "created_desc",
};

// Convert IPv4 to a comparable integer; unknown/empty sorts last.
function ipToInt(ip) {
  if (!ip) return Number.POSITIVE_INFINITY;
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [naps, setNaps] = useState([]);
  const [mikrotiks, setMikrotiks] = useState([]);
  const [users, setUsers] = useState([]);
  const [ipPool, setIpPool] = useState({ available: [], used: [], cidr: "", total: 0 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [c, p, n, ip, d, u] = await Promise.all([
      api.get("/clients"),
      api.get("/plans"),
      api.get("/nap-boxes"),
      api.get("/ip-pool"),
      api.get("/devices"),
      api.get("/users"),
    ]);
    setClients(c.data); setPlans(p.data); setNaps(n.data); setIpPool(ip.data);
    setMikrotiks(d.data.filter((x) => x.kind === "mikrotik"));
    setUsers(u.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // Unique communities & payment days from data — power the dropdowns.
  const communities = useMemo(() => {
    const s = new Set(clients.map((c) => (c.community || "").trim()).filter(Boolean));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "es"));
  }, [clients]);

  const paymentDays = useMemo(() => {
    const s = new Set(clients.map((c) => c.payment_day).filter((d) => d != null));
    return Array.from(s).sort((a, b) => a - b);
  }, [clients]);

  const filteredClients = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    let list = clients.filter((c) => {
      if (filters.status !== "all" && c.status !== filters.status) return false;
      if (filters.community !== "all" && (c.community || "").trim() !== filters.community) return false;
      if (filters.payment_day !== "all" && String(c.payment_day) !== filters.payment_day) return false;
      if (filters.ip === "with" && !c.ip_address) return false;
      if (filters.ip === "without" && c.ip_address) return false;
      if (filters.from) {
        if (!c.created_at || c.created_at.slice(0, 10) < filters.from) return false;
      }
      if (filters.to) {
        if (!c.created_at || c.created_at.slice(0, 10) > filters.to) return false;
      }
      if (q) {
        const hay = [
          c.full_name, c.phone, c.community, c.address, c.ip_address, c.tag, c.wifi_ssid, c.mikrotik_server,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const collator = new Intl.Collator("es", { sensitivity: "base" });
    const cmp = {
      name_asc: (a, b) => collator.compare(a.full_name || "", b.full_name || ""),
      name_desc: (a, b) => collator.compare(b.full_name || "", a.full_name || ""),
      community_asc: (a, b) => collator.compare(a.community || "\uffff", b.community || "\uffff"),
      community_desc: (a, b) => collator.compare(b.community || "\uffff", a.community || "\uffff"),
      ip_asc: (a, b) => ipToInt(a.ip_address) - ipToInt(b.ip_address),
      ip_desc: (a, b) => ipToInt(b.ip_address) - ipToInt(a.ip_address),
      created_asc: (a, b) => (a.created_at || "").localeCompare(b.created_at || ""),
      created_desc: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
      payment_day_asc: (a, b) => (a.payment_day || 0) - (b.payment_day || 0),
      payment_day_desc: (a, b) => (b.payment_day || 0) - (a.payment_day || 0),
    }[filters.sort];

    return cmp ? [...list].sort(cmp) : list;
  }, [clients, filters]);

  const activeFilterCount =
    (filters.q ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.community !== "all" ? 1 : 0) +
    (filters.payment_day !== "all" ? 1 : 0) +
    (filters.ip !== "all" ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0);

  const fields = [
    { name: "full_name", label: "Nombre completo", required: true, full: true },
    { name: "phone", label: "Teléfono" },
    { name: "community", label: "Comunidad", full: true, placeholder: "Ej: Colonia Centro, Ejido Los Pinos…" },
    { name: "plan_id", label: "Plan", type: "select", options: plans.map((p) => ({ value: p.id, label: `${p.name} · ${p.speed_mbps}M · $${p.price}` })) },
    { name: "nap_box_id", label: "Caja NAP", type: "select", options: naps.map((n) => ({ value: n.id, label: n.name })) },
    { name: "payment_day", label: "Día de pago (1-28)", type: "number", required: true },
    { name: "ip_address", label: "IP",
      suggestions: (() => {
        const list = ipPool.available || [];
        if (editing?.ip_address && !list.includes(editing.ip_address)) return [editing.ip_address, ...list];
        return list;
      })(),
      hint: ipPool.cidr
        ? `Red ${ipPool.cidr} · ${ipPool.available?.length || 0} disponibles / ${ipPool.total} totales · usadas: ${ipPool.used?.length || 0}`
        : "Define tu red (CIDR) en Configuración para ver IPs disponibles.",
      placeholder: ipPool.available?.[0] || "10.10.0.10",
    },
    { name: "mikrotik_server", label: "Servidor Mikrotik", type: "select",
      options: mikrotiks.map((m) => ({ value: m.name, label: `${m.name} · ${m.host}${m.port ? ":" + m.port : ""} · ${m.connection}` })),
      hint: mikrotiks.length ? undefined : "Ve a Mikrotik y registra al menos un router para poder asignarlo aquí.",
    },
    { name: "wifi_ssid", label: "Nombre del WiFi", placeholder: "Ej: NetOps_Familia" },
    { name: "wifi_password", label: "Contraseña del WiFi", placeholder: "Contraseña asignada" },
    { name: "status", label: "Estado", type: "select", options: Object.entries(statusMap).map(([v, i]) => ({ value: v, label: i.label })) },
    { name: "tag", label: "Etiqueta", placeholder: "Ej: VIP, Moroso, Preferente…" },
    { name: "installer_id", label: "Técnico que instaló", type: "select",
      options: users.map((u) => ({ value: u.id, label: `${u.name}${u.role ? " · " + u.role : ""}` })),
      hint: users.length ? undefined : "Sin usuarios registrados — crea usuarios en el panel de Usuarios.",
    },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.plan_id === "") payload.plan_id = null;
      if (payload.nap_box_id === "") payload.nap_box_id = null;
      if (payload.installer_id === "") payload.installer_id = null;
      if (editing) {
        await api.patch(`/clients/${editing.id}`, payload);
        toast.success("Cliente actualizado");
      } else {
        await api.post("/clients", payload);
        toast.success("Cliente creado");
      }
      setEditing(null); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar cliente?")) return;
    try { await api.delete(`/clients/${id}`); toast.success("Eliminado"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Gestiona altas, planes, direcciones y fechas de pago de tu cartera."
        actions={
          <Button data-testid="new-client-btn" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo cliente
          </Button>
        }
      />

      {/* Toolbar: sort + filters */}
      <div className="rounded-md border border-border bg-card p-4 mb-4 space-y-3" data-testid="clients-toolbar">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre, comunidad, teléfono, IP, etiqueta…"
              value={filters.q}
              onChange={(e) => setF("q", e.target.value)}
              data-testid="filter-q"
            />
          </div>
          <div className="min-w-[220px]">
            <Select value={filters.sort} onValueChange={(v) => setF("sort", v)}>
              <SelectTrigger data-testid="filter-sort">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={resetFilters} data-testid="filter-reset" disabled={activeFilterCount === 0}>
            <X className="w-4 h-4 mr-1" /> Limpiar
            {activeFilterCount > 0 && (
              <Badge variant="outline" className="ml-2 h-4 text-[10px] font-mono border-primary/40 text-primary bg-primary/10">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-border">
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Estado</Label>
            <Select value={filters.status} onValueChange={(v) => setF("status", v)}>
              <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(statusMap).map(([v, i]) => (
                  <SelectItem key={v} value={v}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Comunidad</Label>
            <Select value={filters.community} onValueChange={(v) => setF("community", v)}>
              <SelectTrigger data-testid="filter-community"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {communities.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                {communities.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Sin comunidades registradas</div>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Día de pago</Label>
            <Select value={filters.payment_day} onValueChange={(v) => setF("payment_day", v)}>
              <SelectTrigger data-testid="filter-payment-day"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {paymentDays.map((d) => (<SelectItem key={d} value={String(d)}>Día {d}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">IP</Label>
            <Select value={filters.ip} onValueChange={(v) => setF("ip", v)}>
              <SelectTrigger data-testid="filter-ip"><SelectValue /></SelectTrigger>
              <SelectContent>
                {IP_FILTERS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Creado desde</Label>
            <Input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} data-testid="filter-from" />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Creado hasta</Label>
            <Input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} data-testid="filter-to" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Filter className="w-3 h-3" />
          Mostrando {filteredClients.length} de {clients.length} clientes
        </div>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>NAP</TableHead>
              <TableHead className="font-mono">IP</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.length === 0 && (
              <EmptyRow colSpan={9} text={clients.length === 0 ? "Aún no hay clientes. Crea el primero." : "Ningún cliente coincide con los filtros."} />
            )}
            {filteredClients.map((c) => {
              const plan = plans.find((p) => p.id === c.plan_id);
              const nap = naps.find((n) => n.id === c.nap_box_id);
              const s = statusMap[c.status] || statusMap.new;
              return (
                <TableRow key={c.id} data-testid={`client-row-${c.id}`}>
                  <TableCell>
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-muted-foreground">{c.community || c.address || ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{c.phone || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.tag || ""}</div>
                  </TableCell>
                  <TableCell>{plan ? `${plan.name} · ${plan.speed_mbps}M` : "—"}</TableCell>
                  <TableCell>{nap?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.ip_address || "—"}</TableCell>
                  <TableCell>
                    <div className="text-sm">Día {c.payment_day}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.next_due_date?.slice(0, 10)}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs" data-testid={`created-${c.id}`}>{formatDate(c.created_at)}</TableCell>
                  <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Registrar pago" onClick={() => navigate(`/pagos?client=${c.id}`)}><DollarSign className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" title="WhatsApp" onClick={() => navigate(`/whatsapp?client=${c.id}`)}><MessageCircle className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }} data-testid={`edit-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(c.id)} data-testid={`delete-${c.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <FormDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        fields={fields}
        initial={editing || { payment_day: 1, status: "new" }}
        onSubmit={save}
        size="full"
      />
    </div>
  );
}
