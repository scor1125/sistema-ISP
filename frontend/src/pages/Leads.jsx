import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

const TYPES = {
  installation: "Instalación nueva", slowness: "Reporte lentitud",
  password_change: "Cambio contraseña", address_change: "Cambio domicilio", other: "Otro",
};
const STATUS = {
  new: "Nuevo", in_progress: "En proceso", done: "Resuelto", cancelled: "Cancelado",
};

export default function Leads() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const [l, u] = await Promise.all([api.get("/leads"), api.get("/users")]);
    setItems(l.data); setUsers(u.data);
  };
  useEffect(()=>{ load(); }, []);

  const fields = [
    { name: "full_name", label: "Nombre", required: true, full: true },
    { name: "phone", label: "Teléfono", required: true },
    { name: "type", label: "Tipo", type: "select", required: true,
      options: Object.entries(TYPES).map(([v,l])=>({value:v,label:l})) },
    { name: "address", label: "Domicilio", full: true },
    { name: "status", label: "Estado", type: "select",
      options: Object.entries(STATUS).map(([v,l])=>({value:v,label:l})) },
    { name: "assigned_to", label: "Asignado a", type: "select",
      options: users.map(u=>({value:u.id,label:`${u.name} (${u.role})`})) },
    { name: "notes", label: "Notas", type: "textarea", full: true },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (editing) await api.patch(`/leads/${editing.id}`, payload);
      else await api.post("/leads", payload);
      toast.success("Guardado"); setEditing(null); await load();
    } catch(e){ toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if(window.confirm("¿Eliminar?")){ await api.delete(`/leads/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Leads" subtitle="Nuevas instalaciones y reportes: lentitud, cambio de contraseña, cambio de domicilio."
        actions={<Button data-testid="new-lead-btn" onClick={()=>{ setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1"/>Nuevo lead</Button>} />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Teléfono</TableHead>
            <TableHead>Domicilio</TableHead><TableHead>Estado</TableHead><TableHead>Asignado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length===0 && <EmptyRow colSpan={7} />}
            {items.map(l=>{
              const u = users.find(x=>x.id===l.assigned_to);
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.full_name}</TableCell>
                  <TableCell><Badge variant="outline">{TYPES[l.type]}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{l.phone}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.address}</TableCell>
                  <TableCell>{STATUS[l.status]}</TableCell>
                  <TableCell>{u?.name || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={()=>{ setEditing(l); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={()=>del(l.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={(v)=>{setOpen(v); if(!v) setEditing(null);}}
        title={editing?"Editar lead":"Nuevo lead"} fields={fields}
        initial={editing || {type:"installation", status:"new"}} onSubmit={save} />
    </div>
  );
}
