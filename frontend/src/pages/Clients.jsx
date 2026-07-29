import { useCallback, useEffect, useState } from "react";
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
  const [mikrotiks, setMikrotiks] = useState([]);
  const [users, setUsers] = useState([]);
  const [ipPool, setIpPool] = useState({ available: [], used: [], cidr: "", total: 0 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [c, p, n, ip, d, u] = await Promise.all([
      api.get("/clients"),
      api.get("/plans"),
      api.get("/nap-boxes"),
      api.get("/ip-pool"),
      api.get("/devices"),
      api.get("/users"),
    ]);
    setClients(c.data); setPlans(p.data); setNaps(n.data); setIpPool(ip.data);
    setMikrotiks(d.data.filter((x) => x.kind === "mikrotik"));
    setUsers(u.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fields = [
    { name: "full_name", label: "Nombre completo", required: true, full: true },
    { name: "dni", label: "DNI / RFC" },
    { name: "phone", label: "Teléfono" },
    { name: "address", label: "Domicilio", required: true, full: true },
    { name: "community", label: "Comunidad", full: true, placeholder: "Ej: Colonia Centro, Ejido Los Pinos…" },
    { name: "plan_id", label: "Plan", type: "select", options: plans.map(p=>({ value: p.id, label: `${p.name} · ${p.speed_mbps}M · $${p.price}` })) },
    { name: "nap_box_id", label: "Caja NAP", type: "select", options: naps.map(n=>({ value: n.id, label: n.name })) },
    { name: "payment_day", label: "Día de pago (1-28)", type: "number", required: true },
    { name: "ip_address", label: "IP",
      suggestions: (() => {
        const list = ipPool.available || [];
        if (editing?.ip_address && !list.includes(editing.ip_address)) return [editing.ip_address, ...list];
        return list;
      })(),
      hint: ipPool.cidr
        ? `Red ${ipPool.cidr} · ${ipPool.available?.length || 0} disponibles / ${ipPool.total} totales · usadas: ${ipPool.used?.length || 0}`
        : "Define tu red (CIDR) en Configuración para ver IPs disponibles.",
      placeholder: ipPool.available?.[0] || "10.10.0.10",
    },
    { name: "mikrotik_server", label: "Servidor Mikrotik", type: "select",
      options: mikrotiks.length
        ? mikrotiks.map(m => ({ value: m.name, label: `${m.name} · ${m.host}${m.port ? ":"+m.port : ""} · ${m.connection}` }))
        : [{ value: "", label: "Sin Mikrotiks registrados — agrégalos en Mikrotik" }],
      hint: mikrotiks.length ? undefined : "Ve a Mikrotik y registra al menos un router para poder asignarlo aquí.",
    },
    { name: "wifi_ssid", label: "Nombre del WiFi", placeholder: "Ej: NetOps_Familia" },
    { name: "wifi_password", label: "Contraseña del WiFi", placeholder: "Contraseña asignada" },
    { name: "status", label: "Estado", type: "select", options: Object.entries(statusMap).map(([v,i])=>({ value: v, label: i.label })) },
    { name: "tag", label: "Etiqueta", placeholder: "Ej: VIP, Moroso, Preferente…" },
    { name: "installer_id", label: "Técnico que instaló", type: "select",
      options: users.length
        ? users.map(u => ({ value: u.id, label: `${u.name}${u.role ? " · " + u.role : ""}` }))
        : [{ value: "", label: "Sin usuarios registrados" }],
    },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.plan_id === "") payload.plan_id = null;
      if (payload.nap_box_id === "") payload.nap_box_id = null;
      if (payload.installer_id === "") payload.installer_id = null;
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
        size="2xl"
      />
    </div>
  );
}
