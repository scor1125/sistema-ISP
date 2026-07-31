import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, CalendarIcon, HandCoins, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const parseISODate = (s) => (s ? new Date(s + "T00:00:00") : null);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const t = new Date(); t.setHours(0,0,0,0); return t; };

export default function PromisesPanel() {
  const [payments, setPayments] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("all"); // all | active | expired
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const [p, c, u] = await Promise.all([
      api.get("/payments"), api.get("/clients"), api.get("/users"),
    ]);
    setPayments(p.data.filter((x) => x.is_promise));
    setClients(c.data);
    setUsers(u.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const now = today();
  const enriched = useMemo(() => payments.map((p) => {
    const client = clients.find((c) => c.id === p.client_id);
    const creator = users.find((u) => u.id === p.created_by);
    const promise = parseISODate(p.promise_date);
    const active = promise ? promise >= now : true;
    return { ...p, client, creator, active };
  }), [payments, clients, users, now]);

  const visible = useMemo(() => enriched.filter((p) => {
    if (filter === "active") return p.active;
    if (filter === "expired") return !p.active;
    return true;
  }), [enriched, filter]);

  // Group by creation date (YYYY-MM-DD)
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach((p) => {
      const d = (p.created_at || "").slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(p);
    });
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [visible]);

  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(visible.map((p) => p.id)));
  };
  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`¿Eliminar ${selected.size} promesa(s) de pago?`)) return;
    try {
      await api.post("/payments/bulk-delete", { ids: Array.from(selected) });
      toast.success(`${selected.size} eliminadas`);
      setSelected(new Set());
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setOpen(true)} data-testid="new-promise-btn"><Plus className="w-4 h-4 mr-1" /> Nueva promesa</Button>
        <div className="ml-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-40" data-testid="promise-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="expired">Vencidas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground font-mono">
          {selected.size > 0 && (
            <>
              <span>{selected.size} seleccionadas</span>
              <Button size="sm" variant="destructive" onClick={bulkDelete} data-testid="bulk-delete-btn">
                <Trash2 className="w-4 h-4 mr-1" /> Eliminar
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[36px_1.2fr_.8fr_.8fr_1fr_1fr_.8fr_120px] gap-2 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground font-mono border-b border-border">
          <div><Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="select-all" /></div>
          <div>Cliente</div><div>Monto</div><div>Prórroga</div>
          <div>Fecha promesa</div><div>Creado por</div><div>Estado</div><div className="text-right">Acciones</div>
        </div>
        {groups.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">Sin promesas registradas.</div>
        )}
        {groups.map(([date, items]) => (
          <div key={date}>
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono bg-muted/40 border-b border-border flex items-center gap-2">
              <CalendarIcon className="w-3 h-3" />
              Creación · {date} ({items.length})
            </div>
            {items.map((p) => (
              <div key={p.id} className="grid grid-cols-[36px_1.2fr_.8fr_.8fr_1fr_1fr_.8fr_120px] gap-2 px-4 py-2 items-center border-b border-border/60 hover:bg-accent/40 transition-colors">
                <div><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} data-testid={`sel-${p.id}`} /></div>
                <div>
                  <div className="text-sm font-medium">{p.client?.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.notes || ""}</div>
                </div>
                <div className="font-mono">${p.amount}</div>
                <div className="font-mono text-xs">{p.extension_days ?? "—"} días</div>
                <div className="font-mono text-xs">{p.promise_date || "—"}</div>
                <div className="text-xs">{p.creator?.name || p.created_by_name || "—"}</div>
                <div>
                  {p.active
                    ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10"><CheckCircle2 className="w-3 h-3 mr-1"/>Activa</Badge>
                    : <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">Vencida</Badge>}
                </div>
                <div className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }} data-testid={`edit-promise-${p.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    if (window.confirm("¿Eliminar promesa?")) {
                      await api.delete(`/payments/${p.id}`); toast.success("Eliminada"); load();
                    }
                  }} data-testid={`del-promise-${p.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <PromiseDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }} clients={clients} initial={editing} onSaved={load} />
    </div>
  );
}

function PromiseDialog({ open, onOpenChange, clients, initial, onSaved }) {
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(3);
  const [date, setDate] = useState(addDays(today(), 3));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (initial) {
        setClientId(initial.client_id || "");
        setAmount(String(initial.amount || ""));
        setDays(initial.extension_days ?? 3);
        setDate(initial.promise_date ? parseISODate(initial.promise_date) : addDays(today(), initial.extension_days ?? 3));
        setNotes(initial.notes || "");
      } else {
        setClientId(""); setAmount(""); setDays(3); setDate(addDays(today(), 3)); setNotes("");
      }
    }
  }, [open, initial]);

  // Keep date in sync when days changes.
  const setDaysAndDate = (d) => {
    const n = Number(d) || 0;
    setDays(n);
    setDate(addDays(today(), n));
  };
  const setDateAndDays = (d) => {
    setDate(d);
    const diff = Math.round((d.getTime() - today().getTime()) / 86400000);
    setDays(diff);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!clientId || !amount) { toast.error("Cliente y monto son requeridos"); return; }
    setLoading(true);
    try {
      const payload = {
        client_id: clientId,
        amount: Number(amount),
        method: "other",
        concept: "Promesa de pago",
        is_promise: true,
        promise_date: toISODate(date),
        extension_days: days,
        notes,
      };
      if (initial?.id) {
        await api.patch(`/payments/${initial.id}`, payload);
        toast.success("Promesa actualizada");
      } else {
        await api.post("/payments", payload);
        toast.success("Promesa registrada");
      }
      onOpenChange(false);
      onSaved?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-primary" /> {initial ? "Editar promesa de pago" : "Nueva promesa de pago"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="promise-client"><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="promise-amount" required />
          </div>
          <div>
            <Label>Días de prórroga</Label>
            <Input type="number" min="1" value={days} onChange={(e) => setDaysAndDate(e.target.value)} data-testid="promise-days" />
          </div>
          <div className="col-span-2">
            <Label>Fecha comprometida</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start font-mono" data-testid="promise-date">
                  <CalendarIcon className="w-4 h-4 mr-2" /> {toISODate(date)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0">
                <Calendar mode="single" selected={date} onSelect={(d) => d && setDateAndDays(d)} initialFocus />
              </PopoverContent>
            </Popover>
          </div>
          <div className="col-span-2">
            <Label>Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo, contexto, acuerdos…" />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={loading} data-testid="promise-submit">
              {loading ? "Guardando…" : initial ? "Guardar cambios" : "Registrar promesa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
