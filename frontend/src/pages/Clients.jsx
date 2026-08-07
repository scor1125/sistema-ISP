import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, MessageCircle, DollarSign, Search, X, ArrowUpDown, Filter, Columns3, Activity, ChevronDown, ChevronUp, KeyRound, Copy } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import ClientDetail from "@/components/ClientDetail";

const statusMap = {
  active: { label: "Activo", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  suspended: { label: "Suspendido", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  offline: { label: "Offline", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  new: { label: "Nuevo", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
};

// Column catalog. `default` = shown out of the box; users can toggle any of them.
const COLUMNS = [
  { key: "client", label: "Cliente", default: true, always: true },
  { key: "contact", label: "Contacto", default: true },
  { key: "plan", label: "Plan", default: true },
  { key: "nap", label: "NAP", default: true },
  { key: "ip", label: "IP", default: true },
  { key: "power", label: "Potencia ONU", default: true },
  { key: "payment", label: "Pago", default: true },
  { key: "created", label: "Creado", default: true },
  { key: "status", label: "Estado", default: true },
  { key: "wifi", label: "WiFi", default: false },
  { key: "server", label: "Servidor Mikrotik", default: false },
  { key: "tag", label: "Etiqueta", default: false },
  { key: "actions", label: "Acciones", default: true, always: true },
];

const COLS_STORAGE_KEY = "netops-client-cols";

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
  q: "", status: "all", community: "all", payment_day: "all", ip: "all",
  from: "", to: "", sort: "created_desc",
};

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
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function powerCls(p, high = -8, low = -27) {
  if (p == null) return "text-muted-foreground";
  if (p > high || p < low) return "text-red-400";
  if (p > high + 4 || p < low - -2) return "text-amber-400";
  return "text-emerald-400";
}

function loadColsFromStorage() {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch (err) {
    console.warn("[Clients] failed to parse column preferences:", err);
  }
  return null;
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [naps, setNaps] = useState([]);
  const [mikrotiks, setMikrotiks] = useState([]);
  const [users, setUsers] = useState([]);
  const [onus, setOnus] = useState([]);
  const [ipPool, setIpPool] = useState({ available: [], used: [], cidr: "", total: 0 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [detail, setDetail] = useState(null); // client whose real-time drawer is open
  const [visibleCols, setVisibleCols] = useState(() => {
    const stored = loadColsFromStorage();
    return stored || new Set(COLUMNS.filter((c) => c.default).map((c) => c.key));
  });
  const [showFilters, setShowFilters] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("netops-client-filters-open") === "1";
  });
  const navigate = useNavigate();

  const toggleFilters = () => {
    setShowFilters((v) => {
      const next = !v;
      localStorage.setItem("netops-client-filters-open", next ? "1" : "0");
      return next;
    });
  };

  const load = useCallback(async () => {
    const [c, p, n, ip, d, u, o] = await Promise.all([
      api.get("/clients"),
      api.get("/plans"),
      api.get("/nap-boxes"),
      api.get("/ip-pool"),
      api.get("/devices"),
      api.get("/users"),
      api.get("/onus"),
    ]);
    setClients(c.data); setPlans(p.data); setNaps(n.data); setIpPool(ip.data);
    setMikrotiks(d.data.filter((x) => x.kind === "mikrotik"));
    setUsers(u.data);
    setOnus(o.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Index ONUs by client_id for O(1) power lookup while rendering rows.
  const onusById = useMemo(() => {
    const m = new Map();
    onus.forEach((o) => m.set(o.client_id, o));
    return m;
  }, [onus]);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const toggleCol = (key) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      // Always keep required columns
      COLUMNS.filter((c) => c.always).forEach((c) => next.add(c.key));
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const resetCols = () => {
    const def = new Set(COLUMNS.filter((c) => c.default).map((c) => c.key));
    localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(Array.from(def)));
    setVisibleCols(def);
  };

  const showCol = (key) => visibleCols.has(key);

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
      if (filters.from && (!c.created_at || c.created_at.slice(0, 10) < filters.from)) return false;
      if (filters.to && (!c.created_at || c.created_at.slice(0, 10) > filters.to)) return false;
      if (q) {
        const hay = [c.full_name, c.phone, c.community, c.address, c.ip_address, c.tag, c.wifi_ssid, c.mikrotik_server]
          .filter(Boolean).join(" ").toLowerCase();
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
    { name: "mikrotik_interface", label: "Interfaz", type: "select",
      options: (v) => {
        const mk = mikrotiks.find((m) => m.name === v.mikrotik_server);
        const list = (mk?.interfaces && mk.interfaces.length > 0)
          ? mk.interfaces
          : ["ether1","ether2","ether3","ether4","bridge","vlan-clientes","pppoe-out1","wg-crm"];
        return list.map((i) => ({ value: i, label: i }));
      },
      hint: "Interfaz del Mikrotik donde está conectado este cliente.",
    },
    { name: "wifi_ssid", label: "Nombre del WiFi", placeholder: "Ej: NetOps_Familia" },
    { name: "wifi_password", label: "Contraseña del WiFi", placeholder: "Contraseña asignada" },
    { name: "status", label: "Estado", type: "select", options: Object.entries(statusMap).map(([v, i]) => ({ value: v, label: i.label })) },
    { name: "tag", label: "Etiqueta", placeholder: "Ej: VIP, Moroso, Preferente…" },
    { name: "installer_ids", label: "Técnicos que instalaron", type: "multiselect",
      placeholder: "Selecciona uno o más técnicos…",
      options: users.map((u) => ({ value: u.id, label: `${u.name}${u.role ? " · " + u.role : ""}` })),
      hint: users.length ? "Puedes elegir varios técnicos que participaron en la instalación." : "Sin usuarios registrados — crea usuarios en el panel de Usuarios.",
    },
    { name: "vlan", label: "VLAN", type: "number", placeholder: "Ej: 100",
      hint: "Número de VLAN asignada al cliente en el switch/Mikrotik.",
    },
    { name: "onu_mac", label: "MAC de la ONU",
      placeholder: "aa:bb:cc:dd:ee:ff",
      suggestions: (() => {
        const macs = onus.map((o) => o.mac).filter(Boolean);
        return Array.from(new Set(macs));
      })(),
      hint: "Amarra la ONU a su IP. Elige de la lista o pega la MAC.",
    },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.plan_id === "") payload.plan_id = null;
      if (payload.nap_box_id === "") payload.nap_box_id = null;
      if (payload.installer_id === "") payload.installer_id = null;
      // installer_ids arrives as an array; mirror the first one to legacy
      // installer_id so older code paths keep working.
      if (Array.isArray(payload.installer_ids)) {
        payload.installer_id = payload.installer_ids[0] || null;
      }
      if (payload.vlan === "" || payload.vlan == null) payload.vlan = null;
      if (payload.onu_mac) payload.onu_mac = String(payload.onu_mac).trim().toLowerCase();
      if (editing) {
        await api.patch(`/clients/${editing.id}`, payload);
        toast.success("Cliente actualizado");
      } else {
        const { data } = await api.post("/clients", payload);
        if (data?.portal_pin) {
          const portalUrl = `${window.location.origin}/portal`;
          toast.success(
            `Cliente creado · PIN ${data.portal_pin}`,
            {
              description: `Compártele: ${portalUrl} (tel: ${data.phone || ""} · PIN: ${data.portal_pin})`,
              duration: 15000,
              action: {
                label: "Copiar PIN",
                onClick: () => { navigator.clipboard.writeText(data.portal_pin); toast("PIN copiado"); },
              },
            }
          );
        } else {
          toast.success("Cliente creado");
        }
      }
      setEditing(null); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const regeneratePin = async (c) => {
    try {
      const { data } = await api.post(`/clients/${c.id}/regenerate-pin`);
      const portalUrl = `${window.location.origin}/portal`;
      toast.success(`PIN nuevo: ${data.portal_pin}`, {
        description: `${c.full_name} · ${portalUrl} · tel: ${data.phone || c.phone || ""}`,
        duration: 15000,
        action: {
          label: "Copiar todo",
          onClick: () => {
            navigator.clipboard.writeText(
              `EnlaceHR ISP · Portal cliente\n${portalUrl}\nTeléfono: ${data.phone || c.phone || ""}\nPIN: ${data.portal_pin}`
            );
            toast("Copiado");
          },
        },
      });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar cliente?")) return;
    try { await api.delete(`/clients/${id}`); toast.success("Eliminado"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const visibleCount = COLUMNS.filter((c) => showCol(c.key)).length;

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

      <div className="rounded-md border border-border bg-card p-3 mb-4" data-testid="clients-toolbar">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nombre, comunidad, teléfono, IP, etiqueta…"
              value={filters.q} onChange={(e) => setF("q", e.target.value)} data-testid="filter-q" />
          </div>

          <Button variant="outline" onClick={toggleFilters} data-testid="filters-toggle">
            <Filter className="w-4 h-4 mr-1" />
            Filtros
            {activeFilterCount > 0 && (
              <Badge variant="outline" className="ml-2 h-4 text-[10px] font-mono border-primary/40 text-primary bg-primary/10">
                {activeFilterCount}
              </Badge>
            )}
            {showFilters ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
          </Button>

          <div className="min-w-[200px]">
            <Select value={filters.sort} onValueChange={(v) => setF("sort", v)}>
              <SelectTrigger data-testid="filter-sort">
                <div className="flex items-center gap-2"><ArrowUpDown className="w-3.5 h-3.5" /><SelectValue /></div>
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="cols-trigger">
                <Columns3 className="w-4 h-4 mr-1" /> Columnas
                <Badge variant="outline" className="ml-2 h-4 text-[10px] font-mono">{visibleCount}/{COLUMNS.length}</Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3" data-testid="cols-panel">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Columnas visibles</div>
              <div className="space-y-1.5">
                {COLUMNS.map((c) => {
                  const disabled = c.always;
                  return (
                    <label key={c.key} className={`flex items-center gap-2 text-sm px-2 py-1 rounded-md ${disabled ? "opacity-60" : "hover:bg-accent cursor-pointer"}`}>
                      <Checkbox checked={showCol(c.key)} disabled={disabled}
                        onCheckedChange={() => !disabled && toggleCol(c.key)} data-testid={`col-${c.key}`} />
                      <span>{c.label}</span>
                      {disabled && <span className="ml-auto text-[10px] text-muted-foreground uppercase font-mono">fijo</span>}
                    </label>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="w-full mt-2" onClick={resetCols} data-testid="cols-reset">
                Restaurar por defecto
              </Button>
            </PopoverContent>
          </Popover>

          <Button variant="outline" onClick={resetFilters} data-testid="filter-reset" disabled={activeFilterCount === 0}>
            <X className="w-4 h-4 mr-1" /> Limpiar
          </Button>

          <div className="ml-auto text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Filter className="w-3 h-3" />
            {filteredClients.length} / {clients.length}
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 mt-3 border-t border-border" data-testid="filters-panel">
            <div>
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Estado</Label>
              <Select value={filters.status} onValueChange={(v) => setF("status", v)}>
                <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(statusMap).map(([v, i]) => (<SelectItem key={v} value={v}>{i.label}</SelectItem>))}
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
        )}
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {showCol("client") && <TableHead>Cliente</TableHead>}
              {showCol("contact") && <TableHead>Contacto</TableHead>}
              {showCol("plan") && <TableHead>Plan</TableHead>}
              {showCol("nap") && <TableHead>NAP</TableHead>}
              {showCol("ip") && <TableHead className="font-mono">IP</TableHead>}
              {showCol("power") && <TableHead>Potencia ONU</TableHead>}
              {showCol("payment") && <TableHead>Pago</TableHead>}
              {showCol("created") && <TableHead>Creado</TableHead>}
              {showCol("status") && <TableHead>Estado</TableHead>}
              {showCol("wifi") && <TableHead>WiFi</TableHead>}
              {showCol("server") && <TableHead>Servidor</TableHead>}
              {showCol("tag") && <TableHead>Etiqueta</TableHead>}
              {showCol("actions") && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.length === 0 && (
              <EmptyRow colSpan={visibleCount} text={clients.length === 0 ? "Aún no hay clientes. Crea el primero." : "Ningún cliente coincide con los filtros."} />
            )}
            {filteredClients.map((c) => {
              const plan = plans.find((p) => p.id === c.plan_id);
              const nap = naps.find((n) => n.id === c.nap_box_id);
              const s = statusMap[c.status] || statusMap.new;
              const onu = onusById.get(c.id);
              return (
                <TableRow
                  key={c.id}
                  data-testid={`client-row-${c.id}`}
                  className="cursor-pointer hover:bg-accent/40"
                  onClick={() => setDetail(c)}
                >
                  {showCol("client") && (
                    <TableCell>
                      <div className="font-medium">{c.full_name}</div>
                      <div className="text-xs text-muted-foreground">{c.community || c.address || ""}</div>
                    </TableCell>
                  )}
                  {showCol("contact") && (
                    <TableCell>
                      <div className="text-sm">{c.phone || "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.tag || ""}</div>
                    </TableCell>
                  )}
                  {showCol("plan") && <TableCell>{plan ? `${plan.name} · ${plan.speed_mbps}M` : "—"}</TableCell>}
                  {showCol("nap") && <TableCell>{nap?.name || "—"}</TableCell>}
                  {showCol("ip") && <TableCell className="font-mono text-xs">{c.ip_address || "—"}</TableCell>}
                  {showCol("power") && (
                    <TableCell className={`font-mono text-xs ${powerCls(onu?.power_dbm)}`} data-testid={`power-${c.id}`}>
                      {onu?.power_dbm != null ? `${onu.power_dbm} dBm` : "—"}
                    </TableCell>
                  )}
                  {showCol("payment") && (
                    <TableCell>
                      <div className="text-sm">Día {c.payment_day}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.next_due_date?.slice(0, 10)}</div>
                    </TableCell>
                  )}
                  {showCol("created") && <TableCell className="font-mono text-xs" data-testid={`created-${c.id}`}>{formatDate(c.created_at)}</TableCell>}
                  {showCol("status") && <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>}
                  {showCol("wifi") && (
                    <TableCell className="font-mono text-xs">
                      <div>{c.wifi_ssid || "—"}</div>
                      <div className="text-muted-foreground">{c.wifi_password || ""}</div>
                    </TableCell>
                  )}
                  {showCol("server") && <TableCell className="font-mono text-xs">{c.mikrotik_server || "—"}</TableCell>}
                  {showCol("tag") && <TableCell>{c.tag ? <Badge variant="outline">{c.tag}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>}
                  {showCol("actions") && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" title="Tráfico en vivo" onClick={() => setDetail(c)} data-testid={`traffic-${c.id}`}><Activity className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Registrar pago" onClick={() => navigate(`/pagos?client=${c.id}`)}><DollarSign className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="WhatsApp" onClick={() => navigate(`/whatsapp?client=${c.id}`)}><MessageCircle className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }} data-testid={`edit-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => regeneratePin(c)} data-testid={`portal-pin-${c.id}`} title="Regenerar PIN de portal"><KeyRound className="w-4 h-4 text-amber-400" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)} data-testid={`delete-${c.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  )}
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
        initial={editing
          ? {
              ...editing,
              // Seed installer_ids from legacy installer_id when only the old
              // field exists on this record — so the multi-select is prefilled.
              installer_ids: Array.isArray(editing.installer_ids) && editing.installer_ids.length > 0
                ? editing.installer_ids
                : (editing.installer_id ? [editing.installer_id] : []),
            }
          : { payment_day: 1, status: "new", installer_ids: [] }}
        onSubmit={save}
        size="full"
      />

      <ClientDetail
        client={detail}
        open={!!detail}
        onOpenChange={(v) => { if (!v) setDetail(null); }}
      />
    </div>
  );
}
