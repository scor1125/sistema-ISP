import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Pencil, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function Lugares() {
  const [items, setItems] = useState([]);
  const [clientCounts, setClientCounts] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const [lg, cl] = await Promise.all([
        api.get("/lugares"),
        api.get("/clients"),
      ]);
      setItems(lg.data);
      // Count clients per place name
      const counts = {};
      cl.data.forEach((c) => {
        const k = (c.community || "").trim();
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
      setClientCounts(counts);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return items;
    return items.filter((l) => norm(`${l.name} ${l.notes||""}`).includes(nq));
  }, [items, q]);

  const totalUsed = useMemo(
    () => items.reduce((a, l) => a + (clientCounts[l.name] || 0), 0),
    [items, clientCounts]
  );

  const fields = [
    { name: "name", label: "Nombre del lugar", required: true, full: true, placeholder: "Ej: Colonia Centro, Ejido Los Pinos…" },
    { name: "color", label: "Color", type: "color" },
    { name: "notes", label: "Notas", type: "textarea", full: true, placeholder: "Descripción opcional del lugar…" },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (editing) {
        await api.patch(`/lugares/${editing.id}`, payload);
        toast.success("Lugar actualizado");
      } else {
        await api.post("/lugares", payload);
        toast.success("Lugar creado");
      }
      setEditing(null); setOpen(false);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (l) => {
    const count = clientCounts[l.name] || 0;
    const suffix = count > 0
      ? `\n\n⚠️ ${count} cliente(s) están asignados a este lugar; sus registros mantendrán el nombre pero perderán el vínculo.`
      : "";
    if (!confirm(`¿Eliminar el lugar "${l.name}"?${suffix}`)) return;
    try {
      await api.delete(`/lugares/${l.id}`);
      toast.success("Lugar eliminado");
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Lugares"
        subtitle="Catálogo de comunidades / zonas donde tienes clientes. Se usa para el campo Lugar en el registro de clientes."
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }} data-testid="lugar-new">
            <Plus className="w-4 h-4 mr-1" /> Nuevo lugar
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Total lugares</div>
          <div className="mt-2 text-3xl font-bold tracking-tight" data-testid="lugar-kpi-total">{items.length}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Clientes con lugar</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-400">{totalUsed}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Sin usar</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-400">
            {items.filter((l) => !clientCounts[l.name]).length}
          </div>
        </div>
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre o notas…" testId="lugar-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lugar</TableHead>
              <TableHead>Notas</TableHead>
              <TableHead className="text-center">Clientes</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-10 text-sm">
                  <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  {q ? "Sin resultados con ese filtro." : "Aún no hay lugares. Crea el primero."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((l) => (
              <TableRow key={l.id} data-testid={`lugar-row-${l.id}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color || "#38bdf8" }} />
                    <span>{l.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{l.notes || "—"}</span>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className={clientCounts[l.name] ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-slate-500/10 border-slate-500/40 text-slate-400"}>
                    {clientCounts[l.name] || 0}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(l); setOpen(true); }} data-testid={`lugar-edit-${l.id}`}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del(l)} data-testid={`lugar-delete-${l.id}`}>
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
        title={editing ? "Editar lugar" : "Nuevo lugar"}
        fields={fields}
        initial={editing || { color: "#38bdf8" }}
        onSubmit={save}
        submitLabel={editing ? "Guardar cambios" : "Crear lugar"}
      />
    </div>
  );
}
