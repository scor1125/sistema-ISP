import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Pencil, HardHat, Phone, Mail, MapPin } from "lucide-react";
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

export default function Trabajadores() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

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
  useEffect(() => { load(); }, [load]);

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
      // Coerce
      if (payload.active !== undefined) payload.active = String(payload.active) === "true";
      if (payload.daily_rate === "" || payload.daily_rate == null) delete payload.daily_rate;
      if (payload.user_id === "" ) payload.user_id = null;
      if (editing) {
        await api.patch(`/trabajadores/${editing.id}`, payload);
        toast.success("Trabajador actualizado");
      } else {
        await api.post("/trabajadores", payload);
        toast.success("Trabajador creado");
      }
      setEditing(null); setOpen(false);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (t) => {
    if (!confirm(`¿Eliminar a ${t.full_name}?`)) return;
    try {
      await api.delete(`/trabajadores/${t.id}`);
      toast.success("Trabajador eliminado");
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const initialForEdit = editing ? {
    ...editing,
    active: String(editing.active),
    user_id: editing.user_id || "",
  } : { role: "technician", active: "true" };

  return (
    <div>
      <PageHeader
        title="Trabajadores"
        subtitle="Nómina operativa: técnicos, instaladores y personal de campo."
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }} data-testid="trabajador-new">
            <Plus className="w-4 h-4 mr-1" /> Nuevo trabajador
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Total</div>
          <div className="mt-2 text-3xl font-bold tracking-tight" data-testid="trabajador-kpi-total">{totals.total}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Activos</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-400" data-testid="trabajador-kpi-active">{totals.active}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Campo (téc + instal.)</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-sky-400">{totals.technicians}</div>
        </div>
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, rol, zona…" testId="trabajador-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Zona</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">
                  <HardHat className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  {q ? "Sin resultados con ese filtro." : "Aún no hay trabajadores. Crea el primero."}
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

      <FormDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar trabajador" : "Nuevo trabajador"}
        fields={fields}
        initial={initialForEdit}
        onSubmit={save}
        submitLabel={editing ? "Guardar cambios" : "Crear trabajador"}
        size="xl"
      />
    </div>
  );
}
