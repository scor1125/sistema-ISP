import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ROLES = { owner:"Dueño", admin:"Administrador", technician:"Técnico", secretary:"Secretaria" };

export default function Users() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  const load = async () => setItems((await api.get("/users")).data);
  useEffect(()=>{ load(); }, []);

  const fields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"email", label:"Email", required:true },
    { name:"phone", label:"Teléfono" },
    { name:"role", label:"Rol", type:"select", required:true,
      options: Object.entries(ROLES).map(([v,l])=>({value:v,label:l})) },
    { name:"password", label:"Contraseña", required:true, full:true },
  ];

  const save = async (v) => {
    try { await api.post("/users", v); toast.success("Usuario creado"); await load(); }
    catch(e){ toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if(window.confirm("¿Eliminar usuario?")){ await api.delete(`/users/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Usuarios del sistema"
        subtitle="Da acceso a técnicos, secretaria u otros con roles específicos."
        actions={<Button data-testid="new-user-btn" onClick={()=>setOpen(true)}><Plus className="w-4 h-4 mr-1"/>Nuevo usuario</Button>} />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Email</TableHead>
            <TableHead>Rol</TableHead><TableHead>Teléfono</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length===0 && <EmptyRow colSpan={6} />}
            {items.map(u=>(
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell><Badge variant="outline">{ROLES[u.role] || u.role}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{u.phone || "—"}</TableCell>
                <TableCell>{u.active!==false ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>del(u.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={setOpen} title="Nuevo usuario"
        fields={fields} initial={{role:"technician"}} onSubmit={save} />
    </div>
  );
}
