import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, MessageCircle, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const statusMap = {
  active: { label: "Activo", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  suspended: { label: "Suspendido", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  offline: { label: "Offline", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  new: { label: "Nuevo", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
};

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [naps, setNaps] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    const [c, p, n] = await Promise.all([api.get("/clients"), api.get("/plans"), api.get("/nap-boxes")]);
    setClients(c.data); setPlans(p.data); setNaps(n.data);
  };

  useEffect(() => { load(); }, []);

  const fields = [
    { name: "full_name", label: "Nombre completo", required: true, full: true },
    { name: "dni", label: "DNI / RFC" },
    { name: "phone", label: "Teléfono" },
    { name: "email", label: "Email" },
    { name: "address", label: "Domicilio", required: true, full: true },
    { name: "lat", label: "Latitud", type: "number" },
    { name: "lng", label: "Longitud", type: "number" },
    { name: "plan_id", label: "Plan", type: "select", options: plans.map(p=>({ value: p.id, label: `${p.name} · ${p.speed_mbps}M · $${p.price}` })) },
    { name: "nap_box_id", label: "Caja NAP", type: "select", options: naps.map(n=>({ value: n.id, label: n.name })) },
    { name: "payment_day", label: "Día de pago (1-28)", type: "number", required: true },
    { name: "onu_serial", label: "Serial ONU" },
    { name: "ip_address", label: "IP" },
    { name: "mikrotik_server", label: "Servidor Mikrotik" },
    { name: "status", label: "Estado", type: "select", options: Object.entries(statusMap).map(([v,i])=>({ value: v, label: i.label })) },
    { name: "notes", label: "Notas", type: "textarea", full: true },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.plan_id === "") payload.plan_id = null;
      if (payload.nap_box_id === "") payload.nap_box_id = null;
      if (editing) {
        await api.patch(`/clients/${editing.id}`, payload);
        toast.success("Cliente actualizado");
      } else {
        await api.post("/clients", payload);
        toast.success("Cliente creado");
      }
      setEditing(null); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar cliente?")) return;
    try { await api.delete(`/clients/${id}`); toast.success("Eliminado"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Gestiona altas, planes, direcciones y fechas de pago de tu cartera."
        actions={
          <Button data-testid="new-client-btn" onClick={()=>{ setEditing(null); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo cliente
          </Button>
        }
      />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>NAP</TableHead>
              <TableHead className="font-mono">IP</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 && <EmptyRow colSpan={8} text="Aún no hay clientes. Crea el primero." />}
            {clients.map((c)=>{
              const plan = plans.find(p=>p.id===c.plan_id);
              const nap = naps.find(n=>n.id===c.nap_box_id);
              const s = statusMap[c.status] || statusMap.new;
              return (
                <TableRow key={c.id} data-testid={`client-row-${c.id}`}>
                  <TableCell>
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-muted-foreground">{c.address}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{c.phone || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.email || ""}</div>
                  </TableCell>
                  <TableCell>{plan ? `${plan.name} · ${plan.speed_mbps}M` : "—"}</TableCell>
                  <TableCell>{nap?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.ip_address || "—"}</TableCell>
                  <TableCell>
                    <div className="text-sm">Día {c.payment_day}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.next_due_date?.slice(0,10)}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Registrar pago" onClick={()=>navigate(`/pagos?client=${c.id}`)}><DollarSign className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" title="WhatsApp" onClick={()=>navigate(`/whatsapp?client=${c.id}`)}><MessageCircle className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={()=>{ setEditing(c); setOpen(true); }} data-testid={`edit-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={()=>remove(c.id)} data-testid={`delete-${c.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <FormDialog
        open={open}
        onOpenChange={(v)=>{ setOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        fields={fields}
        initial={editing || { payment_day: 1, status: "new" }}
        onSubmit={save}
      />
    </div>
  );
}
