import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, HardHat, Phone, Mail, MapPin, ChevronLeft, ChevronRight, CalendarClock, DollarSign, Check } from "lucide-react";
import { toast } from "sonner";

const ROLES = {
  technician: "Técnico",
  installer: "Instalador",
  secretary: "Secretaria",
  supervisor: "Supervisor",
  other: "Otro",
};
const ROLE_TONE = {
  technician: "bg-sky-500/15 border-sky-500/40 text-sky-300",
  installer: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  secretary: "bg-purple-500/15 border-purple-500/40 text-purple-300",
  supervisor: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  other: "bg-slate-500/15 border-slate-500/40 text-slate-300",
};

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function toISO(d) { return d.toISOString().slice(0, 10); }
function fmtShort(iso) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  } catch { return iso; }
}
// Return the Sunday of the week containing `anchor` (Date).
function sundayOf(anchor) {
  const d = new Date(anchor);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
function moneyMX(n) {
  return `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Trabajadores() {
  // We keep the file/name "Trabajadores" but the whole UI is now "Colaboradores"
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [weekAnchor, setWeekAnchor] = useState(() => sundayOf(new Date()));
  const [summary, setSummary] = useState({ trabajadores: [], week_start: "", week_end: "", grand_total: 0 });

  const load = useCallback(async () => {
    try {
      const [tr, us] = await Promise.all([
        api.get("/trabajadores"),
        api.get("/users").catch(() => ({ data: [] })),
      ]);
      setItems(tr.data);
      setUsers(us.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/trabajadores/week-summary", { params: { anchor: toISO(weekAnchor) } });
      setSummary(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [weekAnchor]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary, items]);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return items;
    return items.filter((t) =>
      norm(`${t.full_name} ${t.phone||""} ${t.email||""} ${t.community||""} ${ROLES[t.role]||t.role||""}`).includes(nq)
    );
  }, [items, q]);

  const totals = useMemo(() => ({
    total: items.length,
    active: items.filter(t => t.active).length,
    technicians: items.filter(t => t.role === "technician" || t.role === "installer").length,
  }), [items]);

  const fields = useMemo(() => [
    { name: "full_name", label: "Nombre completo", required: true, full: true },
    { name: "role", label: "Rol", type: "select", required: true,
      options: Object.entries(ROLES).map(([v, l]) => ({ value: v, label: l })) },
    { name: "phone", label: "Teléfono" },
    { name: "email", label: "Email" },
    { name: "community", label: "Zona / comunidad", placeholder: "Ej: Centro, Norte…" },
    { name: "hire_date", label: "Fecha de ingreso", type: "date" },
    { name: "daily_rate", label: "Sueldo diario", type: "number", placeholder: "0" },
    { name: "active", label: "Estado", type: "select",
      options: [{ value: "true", label: "Activo" }, { value: "false", label: "Inactivo" }] },
    { name: "user_id", label: "Vincular a usuario del sistema (opcional)", type: "select",
      options: [{ value: "", label: "— Sin vínculo —" }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.email})` }))] },
    { name: "notes", label: "Notas", type: "textarea", full: true },
  ], [users]);

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.active !== undefined) payload.active = String(payload.active) === "true";
      if (payload.daily_rate === "" || payload.daily_rate == null) delete payload.daily_rate;
      if (payload.user_id === "") payload.user_id = null;
      if (editing) {
        await api.patch(`/trabajadores/${editing.id}`, payload);
        toast.success("Colaborador actualizado");
      } else {
        await api.post("/trabajadores", payload);
        toast.success("Colaborador creado");
      }
      setEditing(null); setOpen(false);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (t) => {
    if (!confirm(`¿Eliminar a ${t.full_name}?`)) return;
    try {
      await api.delete(`/trabajadores/${t.id}`);
      toast.success("Colaborador eliminado");
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const toggleDay = async (tid, dateIso) => {
    try {
      await api.post(`/trabajadores/${tid}/work-days/toggle`, { date: dateIso });
      loadSummary();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const initialForEdit = editing ? {
    ...editing,
    active: String(editing.active),
    user_id: editing.user_id || "",
  } : { role: "technician", active: "true" };

  // Build week columns (Sun..Sat)
  const weekDates = useMemo(() => {
    const start = new Date(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      return toISO(d);
    });
  }, [weekAnchor]);

  const shiftWeek = (delta) => {
    const d = new Date(weekAnchor);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekAnchor(d);
  };
  const goCurrentWeek = () => setWeekAnchor(sundayOf(new Date()));

  const isCurrentWeek = toISO(sundayOf(new Date())) === toISO(weekAnchor);
  const isToday = (iso) => iso === toISO(new Date());

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        subtitle="Nómina operativa con control de días trabajados y corte semanal (Domingo → Sábado)."
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }} data-testid="trabajador-new">
            <Plus className="w-4 h-4 mr-1" /> Nuevo colaborador
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Total</div>
          <div className="mt-2 text-3xl font-bold tracking-tight" data-testid="trabajador-kpi-total">{totals.total}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Activos</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-400" data-testid="trabajador-kpi-active">{totals.active}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Campo</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-sky-400">{totals.technicians}</div>
        </div>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-[11px] uppercase tracking-widest text-amber-300 font-mono flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Nómina semanal
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-amber-300" data-testid="colab-weekly-total">
            {moneyMX(summary.grand_total)}
          </div>
          <div className="text-[10px] font-mono text-amber-100/70 mt-0.5">
            {summary.week_start} → {summary.week_end} (Sáb)
          </div>
        </div>
      </div>

      <Tabs defaultValue="week" className="w-full">
        <TabsList data-testid="colab-tabs">
          <TabsTrigger value="week" data-testid="tab-week"><CalendarClock className="w-3 h-3 mr-1" /> Días trabajados</TabsTrigger>
          <TabsTrigger value="roster" data-testid="tab-roster">Roster</TabsTrigger>
        </TabsList>

        {/* WEEKLY TABLE */}
        <TabsContent value="week" className="mt-3">
          <div className="rounded-md border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} data-testid="week-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="font-mono text-xs px-2">
                Semana del <b>{fmtShort(summary.week_start)}</b> al <b>{fmtShort(summary.week_end)}</b>
              </div>
              <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} data-testid="week-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
              {!isCurrentWeek && (
                <Button size="sm" variant="ghost" onClick={goCurrentWeek} data-testid="week-current">
                  Ir a semana actual
                </Button>
              )}
              <Badge variant="outline" className="ml-auto font-mono text-xs bg-amber-500/10 border-amber-500/40 text-amber-300">
                Corte los sábados
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Colaborador</TableHead>
                    <TableHead className="w-24">Sueldo día</TableHead>
                    {weekDates.map((iso, i) => (
                      <TableHead
                        key={iso}
                        className={`text-center w-16 ${isToday(iso) ? "bg-primary/10" : ""} ${i === 6 ? "border-r-2 border-amber-500/40" : ""}`}
                      >
                        <div className="text-[10px] font-mono text-muted-foreground">{DAY_LABELS[i]}</div>
                        <div className="text-xs">{iso.slice(8)}</div>
                      </TableHead>
                    ))}
                    <TableHead className="text-center w-16">Días</TableHead>
                    <TableHead className="text-right w-28">Total semana</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.trabajadores.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground py-8 text-sm">
                        <HardHat className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                        Aún no hay colaboradores. Crea el primero.
                      </TableCell>
                    </TableRow>
                  )}
                  {summary.trabajadores.map((t) => (
                    <TableRow key={t.id} data-testid={`colab-week-row-${t.id}`} className={!t.active ? "opacity-50" : ""}>
                      <TableCell>
                        <div className="font-medium">{t.full_name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge variant="outline" className={`text-[9px] px-1 ${ROLE_TONE[t.role] || ROLE_TONE.other}`}>{ROLES[t.role] || t.role}</Badge>
                          {t.community && <span className="text-[10px] text-muted-foreground">{t.community}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{moneyMX(t.daily_rate)}</TableCell>
                      {weekDates.map((iso, i) => {
                        const worked = t.days_worked_this_week.includes(iso);
                        return (
                          <TableCell
                            key={iso}
                            className={`text-center p-1 ${isToday(iso) ? "bg-primary/5" : ""} ${i === 6 ? "border-r-2 border-amber-500/40" : ""}`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleDay(t.id, iso)}
                              className={`w-9 h-9 rounded-md border transition-colors flex items-center justify-center ${
                                worked
                                  ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/40"
                                  : "bg-background border-input hover:bg-accent text-muted-foreground"
                              }`}
                              data-testid={`day-toggle-${t.id}-${iso}`}
                              title={`${DAY_LABELS[i]} ${iso}${worked ? " · trabajado" : ""}`}
                            >
                              {worked ? <Check className="w-4 h-4" /> : <span className="text-[9px]">—</span>}
                            </button>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-mono">
                        <Badge variant="outline" className="font-mono text-xs">{t.days_count}/7</Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold text-amber-300">
                        {moneyMX(t.weekly_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border p-3 flex items-center justify-between bg-secondary/30">
              <div className="text-xs text-muted-foreground font-mono">
                {summary.trabajadores.reduce((a, t) => a + t.days_count, 0)} días trabajados esta semana
              </div>
              <div className="text-lg font-bold text-amber-300" data-testid="colab-weekly-total-footer">
                {moneyMX(summary.grand_total)}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ROSTER */}
        <TabsContent value="roster" className="mt-3">
          <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, rol, zona…" testId="trabajador-search" />
          <div className="rounded-md border border-border bg-card overflow-hidden mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Sueldo día</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-24 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10 text-sm">
                      <HardHat className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                      {q ? "Sin resultados con ese filtro." : "Aún no hay colaboradores. Crea el primero."}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((t) => (
                  <TableRow key={t.id} data-testid={`trabajador-row-${t.id}`}>
                    <TableCell className="font-medium">{t.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ROLE_TONE[t.role] || ROLE_TONE.other}>{ROLES[t.role] || t.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5 text-xs">
                        {t.phone && <div className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3 h-3" />{t.phone}</div>}
                        {t.email && <div className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" />{t.email}</div>}
                        {!t.phone && !t.email && <span className="text-muted-foreground/60">—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.community
                        ? <span className="text-xs inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-muted-foreground" />{t.community}</span>
                        : <span className="text-muted-foreground/60 text-xs">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{moneyMX(t.daily_rate)}</TableCell>
                    <TableCell>
                      {t.active
                        ? <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/40 text-emerald-300">Activo</Badge>
                        : <Badge variant="outline" className="bg-slate-500/10 border-slate-500/40 text-slate-300">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }} data-testid={`trabajador-edit-${t.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => del(t)} data-testid={`trabajador-delete-${t.id}`}>
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <FormDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar colaborador" : "Nuevo colaborador"}
        fields={fields}
        initial={initialForEdit}
        onSubmit={save}
        submitLabel={editing ? "Guardar cambios" : "Crear colaborador"}
        size="xl"
      />
    </div>
  );
}
