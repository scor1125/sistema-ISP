import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

const ROLES = { owner:"Dueño", admin:"Administrador", technician:"Técnico", secretary:"Secretaria" };

export default function Users() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setItems((await api.get("/users")).data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return items;
    return items.filter((u) => norm(`${u.name} ${u.email} ${u.phone} ${ROLES[u.role]||u.role||""}`).includes(nq));
  }, [items, q]);

  const createFields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"email", label:"Email", required:true },
    { name:"phone", label:"Teléfono" },
    { name:"role", label:"Rol", type:"select", required:true,
      options: Object.entries(ROLES).map(([v,l])=>({value:v,label:l})) },
    { name:"password", label:"Contraseña", required:true, full:true },
  ];

  const editFields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"phone", label:"Teléfono" },
    { name:"role", label:"Rol", type:"select",
      options: Object.entries(ROLES).map(([v,l])=>({value:v,label:l})) },
    { name:"password", label:"Contraseña nueva (dejar en blanco para no cambiar)", full:true, placeholder:"••••••••" },
  ];

  const save = async (v) => {
    try {
      if (editing) {
        const payload = { ...v };
        if (!payload.password) delete payload.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success("Usuario actualizado");
      } else {
        await api.post("/users", v);
        toast.success("Usuario creado");
      }
      setEditing(null); await load();
    } catch(e){ toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if(window.confirm("¿Eliminar usuario?")){ await api.delete(`/users/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Usuarios del sistema"
        subtitle="Da acceso a técnicos, secretaria u otros con roles específicos."
        actions={<Button data-testid="new-user-btn" onClick={()=>{ setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1"/>Nuevo usuario</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, email, teléfono o rol…"
        hint={`${filtered.length} / ${items.length}`} testId="users-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Email</TableHead>
            <TableHead>Rol</TableHead><TableHead>Teléfono</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length===0 && <EmptyRow colSpan={6} text={items.length===0 ? "Sin usuarios. Crea el primero." : "Nada coincide con la búsqueda."} />}
            {filtered.map(u=>(
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell><Badge variant="outline">{ROLES[u.role] || u.role}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{u.phone || "—"}</TableCell>
                <TableCell>{u.active!==false ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>{ setEditing(u); setOpen(true); }} data-testid={`edit-user-${u.id}`}><Pencil className="w-4 h-4"/></Button>
                  <Button size="icon" variant="ghost" onClick={()=>del(u.id)} data-testid={`del-user-${u.id}`}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={(v)=>{ setOpen(v); if(!v) setEditing(null); }}
        title={editing ? "Editar usuario" : "Nuevo usuario"}
        fields={editing ? editFields : createFields}
        initial={editing || {role:"technician"}} onSubmit={save} />
    </div>
  );
}
