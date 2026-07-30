import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

const CATS = { iptv:"IPTV", phone:"Telefonía", extra_mbps:"Megas extras", backup_power:"Energía portátil", other:"Otro" };

export default function Extras() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const load = async () => setItems((await api.get("/extras")).data);
  useEffect(()=>{ load(); }, []);
  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return items;
    return items.filter((x) => norm(`${x.name} ${x.description} ${CATS[x.category]||""} ${x.price}`).includes(nq));
  }, [items, q]);

  const fields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"category", label:"Categoría", type:"select", options: Object.entries(CATS).map(([v,l])=>({value:v,label:l})) },
    { name:"price", label:"Precio", type:"number", required:true },
    { name:"description", label:"Descripción", type:"textarea", full:true },
    { name:"active", label:"Activo", type:"select", options:[{value:"true",label:"Sí"},{value:"false",label:"No"}] },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v, active: String(v.active) !== "false" };
      if (editing) await api.patch(`/extras/${editing.id}`, payload);
      else await api.post("/extras", payload);
      toast.success("Guardado"); setEditing(null); await load();
    } catch(e){ toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if(window.confirm("¿Eliminar?")){ await api.delete(`/extras/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Servicios extras" subtitle="IPTV, telefonía, megas extras y equipos portátiles."
        actions={<Button data-testid="new-extra-btn" onClick={()=>{setEditing(null); setOpen(true);}}><Plus className="w-4 h-4 mr-1"/>Nuevo</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, categoría o descripción…"
        hint={`${filtered.length} / ${items.length}`} testId="extras-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Categoría</TableHead><TableHead>Precio</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length===0 && <EmptyRow colSpan={5} text={items.length===0 ? "Sin servicios. Crea el primero." : "Nada coincide con la búsqueda."} />}
            {filtered.map(x=>(
              <TableRow key={x.id}>
                <TableCell><div className="font-medium">{x.name}</div><div className="text-xs text-muted-foreground">{x.description}</div></TableCell>
                <TableCell>{CATS[x.category]}</TableCell>
                <TableCell className="font-mono">${x.price}</TableCell>
                <TableCell>{x.active!==false ? <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" variant="outline">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>{setEditing(x); setOpen(true);}}><Pencil className="w-4 h-4"/></Button>
                  <Button size="icon" variant="ghost" onClick={()=>del(x.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={(v)=>{setOpen(v); if(!v) setEditing(null);}}
        title={editing?"Editar servicio":"Nuevo servicio"} fields={fields}
        initial={editing || {category:"other", active:true}} onSubmit={save} />
    </div>
  );
}
