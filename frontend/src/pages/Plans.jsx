import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export default function Plans() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => setItems((await api.get("/plans")).data);
  useEffect(() => { load(); }, []);

  const fields = [
    { name: "name", label: "Nombre", required: true, full: true },
    { name: "speed_mbps", label: "Velocidad (Mbps)", type: "number", required: true },
    { name: "price", label: "Precio", type: "number", required: true },
    { name: "description", label: "Descripción", type: "textarea", full: true },
    { name: "active", label: "Activo", type: "select", options: [{value:"true",label:"Sí"},{value:"false",label:"No"}] },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v, active: String(v.active) !== "false" };
      if (editing) await api.patch(`/plans/${editing.id}`, payload);
      else await api.post("/plans", payload);
      toast.success("Guardado"); setEditing(null); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if (window.confirm("¿Eliminar?")) { await api.delete(`/plans/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Planes" subtitle="Los paquetes de internet que ofreces a tus clientes."
        actions={<Button data-testid="new-plan-btn" onClick={()=>{ setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1"/>Nuevo plan</Button>} />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Velocidad</TableHead><TableHead>Precio</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length===0 && <EmptyRow colSpan={5} text="Sin planes. Crea el primero." />}
            {items.map(p=>(
              <TableRow key={p.id}>
                <TableCell><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.description}</div></TableCell>
                <TableCell className="font-mono">{p.speed_mbps} Mbps</TableCell>
                <TableCell className="font-mono">${p.price}</TableCell>
                <TableCell>{p.active !== false ? <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" variant="outline">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>{ setEditing(p); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={()=>del(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={(v)=>{ setOpen(v); if(!v) setEditing(null); }}
        title={editing ? "Editar plan" : "Nuevo plan"} fields={fields} initial={editing || {active:true}} onSubmit={save} />
    </div>
  );
}
