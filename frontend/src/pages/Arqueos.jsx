import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, Kpi, EmptyRow } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calculator, ClipboardCheck, Filter, Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";

const methodLabel = { cash: "Efectivo", transfer: "Transferencia", stripe: "Stripe", other: "Otro" };
const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function Arqueos() {
  const [payments, setPayments] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [arqueos, setArqueos] = useState([]);

  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [userId, setUserId] = useState("all");
  const [method, setMethod] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    const [p, c, u, a] = await Promise.all([
      api.get("/payments"), api.get("/clients"), api.get("/users"), api.get("/arqueos"),
    ]);
    setPayments(p.data); setClients(c.data); setUsers(u.data); setArqueos(a.data);
  };
  useEffect(() => { load(); }, []);

  const clientName = (id) => clients.find((c) => c.id === id)?.full_name || "—";

  const filtered = useMemo(() => {
    const from = dateFrom; // inclusive
    const to = dateTo;     // inclusive
    return payments
      .filter((p) => !p.is_promise)
      .filter((p) => {
        const d = (p.created_at || "").slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (userId !== "all" && p.created_by !== userId) return false;
        if (method !== "all" && p.method !== method) return false;
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [payments, dateFrom, dateTo, userId, method]);

  const filteredTotal = useMemo(() => filtered.reduce((s, p) => s + Number(p.amount || 0), 0), [filtered]);
  const selectedList = useMemo(() => filtered.filter((p) => selected.has(p.id)), [filtered, selected]);
  const selectedTotal = useMemo(() => selectedList.reduce((s, p) => s + Number(p.amount || 0), 0), [selectedList]);

  const allChecked = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allChecked) filtered.forEach((p) => next.delete(p.id));
    else filtered.forEach((p) => next.add(p.id));
    setSelected(next);
  };
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const runArqueo = async () => {
    if (selectedList.length === 0) { toast.error("Seleccioná al menos un pago"); return; }
    try {
      const usr = users.find((u) => u.id === userId);
      const methods = Array.from(new Set(selectedList.map((p) => p.method)));
      await api.post("/arqueos", {
        date_from: dateFrom,
        date_to: dateTo,
        payment_ids: selectedList.map((p) => p.id),
        total_amount: selectedTotal,
        methods,
        user_filter_id: userId === "all" ? null : userId,
        user_filter_name: usr?.name || "",
        notes,
      });
      toast.success("Arqueo registrado");
      setSelected(new Set());
      setNotes("");
      setConfirmOpen(false);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const removeArqueo = async (id) => {
    if (!window.confirm("¿Eliminar este arqueo del historial?")) return;
    try { await api.delete(`/arqueos/${id}`); toast.success("Eliminado"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Arqueo de caja"
        subtitle="Filtra los pagos por rango de fechas, método o cobrador, seleccioná los que entran al arqueo y quedará registrado con fecha, hora y responsable."
      />

      <Tabs defaultValue="nuevo" data-testid="arqueo-tabs">
        <TabsList>
          <TabsTrigger value="nuevo" data-testid="tab-nuevo">Nuevo arqueo</TabsTrigger>
          <TabsTrigger value="historial" data-testid="tab-historial">Historial ({arqueos.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="nuevo" className="mt-4 space-y-4">
          {/* Filtros */}
          <section className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-widest text-muted-foreground font-mono">
              <Filter className="w-3.5 h-3.5" /> Filtros
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="filter-from" />
              </div>
              <div>
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="filter-to" />
              </div>
              <div>
                <Label className="text-xs">Mes / Año</Label>
                <Input
                  type="month"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [y, m] = e.target.value.split("-").map(Number);
                    const last = new Date(y, m, 0).getDate();
                    setDateFrom(`${e.target.value}-01`);
                    setDateTo(`${e.target.value}-${String(last).padStart(2, "0")}`);
                  }}
                  data-testid="filter-month"
                />
              </div>
              <div>
                <Label className="text-xs">Cobrador</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger data-testid="filter-user"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Método</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger data-testid="filter-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {Object.entries(methodLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Pagos en rango" value={filtered.length} />
            <Kpi label="Total en rango" value={`$${filteredTotal.toLocaleString()}`} />
            <Kpi label="Seleccionados" value={selectedList.length} tone="success" />
            <Kpi label="Total arqueo" value={`$${selectedTotal.toLocaleString()}`} tone="success" trend={<span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> a cuadrar</span>} />
          </div>

          {/* Tabla de pagos */}
          <section className="rounded-md border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Pagos disponibles</div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={selectedList.length === 0}
                data-testid="run-arqueo-btn"
              >
                <Calculator className="w-4 h-4 mr-1" /> Realizar arqueo
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allChecked} onCheckedChange={toggleAll} data-testid="check-all" />
                  </TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Cobrador</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <EmptyRow colSpan={8} />}
                {filtered.map((p) => (
                  <TableRow key={p.id} className={selected.has(p.id) ? "bg-primary/5" : ""}>
                    <TableCell>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} data-testid={`check-${p.id}`} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{(p.created_at || "").slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-xs">{(p.created_at || "").slice(11, 16)}</TableCell>
                    <TableCell>{clientName(p.client_id)}</TableCell>
                    <TableCell className="font-mono">${p.amount}</TableCell>
                    <TableCell><Badge variant="outline">{methodLabel[p.method] || p.method}</Badge></TableCell>
                    <TableCell>{p.concept || "—"}</TableCell>
                    <TableCell>{p.created_by_name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <section className="rounded-md border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha del arqueo</TableHead>
                  <TableHead>Rango cubierto</TableHead>
                  <TableHead>Cobrador filtrado</TableHead>
                  <TableHead>Pagos</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Realizado por</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {arqueos.length === 0 && <EmptyRow colSpan={7} />}
                {arqueos.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">
                      {(a.created_at || "").slice(0, 10)} · {(a.created_at || "").slice(11, 16)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.date_from} → {a.date_to}</TableCell>
                    <TableCell>{a.user_filter_name || <span className="text-muted-foreground">Todos</span>}</TableCell>
                    <TableCell className="font-mono">{a.payment_ids?.length || 0}</TableCell>
                    <TableCell className="font-mono text-emerald-400">${Number(a.total_amount).toLocaleString()}</TableCell>
                    <TableCell>{a.created_by_name || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(a)} data-testid={`view-arqueo-${a.id}`}>
                        <ClipboardCheck className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeArqueo(a.id)} data-testid={`del-arqueo-${a.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </TabsContent>
      </Tabs>

      {/* Confirmación */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar arqueo</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Rango</div>
                <div className="font-mono">{dateFrom} → {dateTo}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pagos</div>
                <div className="font-mono">{selectedList.length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-mono text-emerald-400 text-lg">${selectedTotal.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cobrador filtrado</div>
                <div>{userId === "all" ? "Todos" : users.find((u) => u.id === userId)?.name || "—"}</div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del arqueo…" data-testid="arqueo-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={runArqueo} data-testid="confirm-arqueo-btn">Confirmar arqueo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle historial */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle del arqueo</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Realizado</div><div className="font-mono">{(detail.created_at || "").slice(0, 16).replace("T", " ")}</div></div>
                <div><div className="text-xs text-muted-foreground">Por</div><div>{detail.created_by_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Rango</div><div className="font-mono">{detail.date_from} → {detail.date_to}</div></div>
                <div><div className="text-xs text-muted-foreground">Total</div><div className="font-mono text-emerald-400">${Number(detail.total_amount).toLocaleString()}</div></div>
              </div>
              <div className="rounded-md border border-border overflow-hidden max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Fecha</TableHead><TableHead>Cliente</TableHead>
                    <TableHead>Monto</TableHead><TableHead>Método</TableHead><TableHead>Cobrador</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(detail.payment_ids || []).map((pid) => {
                      const p = payments.find((x) => x.id === pid);
                      if (!p) return (
                        <TableRow key={pid}><TableCell colSpan={5} className="text-xs text-muted-foreground">Pago eliminado (id {pid.slice(0, 8)}…)</TableCell></TableRow>
                      );
                      return (
                        <TableRow key={pid}>
                          <TableCell className="font-mono text-xs">{(p.created_at || "").slice(0, 16).replace("T", " ")}</TableCell>
                          <TableCell>{clientName(p.client_id)}</TableCell>
                          <TableCell className="font-mono">${p.amount}</TableCell>
                          <TableCell><Badge variant="outline">{methodLabel[p.method] || p.method}</Badge></TableCell>
                          <TableCell>{p.created_by_name || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {detail.notes && (
                <div className="text-sm"><span className="text-xs text-muted-foreground">Notas: </span>{detail.notes}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
