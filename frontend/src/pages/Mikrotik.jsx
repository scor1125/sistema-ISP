import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import VpnPanel from "@/components/VpnPanel";
import { Plus, Router, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { differenceInDays, parseISO } from "date-fns";

export default function Mikrotik() {
  const [onus, setOnus] = useState([]);
  const [plans, setPlans] = useState([]);
  const [devices, setDevices] = useState([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const [o, p, d] = await Promise.all([api.get("/onus"), api.get("/plans"), api.get("/devices")]);
    setOnus(o.data); setPlans(p.data);
    setDevices(d.data.filter(x=>x.kind==="mikrotik"));
  };
  useEffect(()=>{ load(); }, []);

  const fields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"host", label:"Host / IP", required:true },
    { name:"port", label:"Puerto", type:"number" },
    { name:"username", label:"Usuario" },
    { name:"connection", label:"Conexión", type:"select", options:[
      {value:"public_ip", label:"IP pública"}, {value:"vpn", label:"VPN"}
    ]},
    { name:"location", label:"Ubicación" },
    { name:"notes", label:"Notas", type:"textarea", full:true },
  ];

  const save = async (v) => {
    try {
      await api.post("/devices", { ...v, kind: "mikrotik" });
      toast.success("Mikrotik registrado"); await load();
    } catch(e){ toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if(window.confirm("¿Eliminar?")){ await api.delete(`/devices/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Mikrotik"
        subtitle="Panel vinculado con OLT. Muestra IP, consumo, plan y estado de pago. Registra tus routers y conecta vía VPN o IP pública."
        actions={<Button data-testid="new-mk-btn" onClick={()=>setOpen(true)}><Plus className="w-4 h-4 mr-1"/>Nuevo Mikrotik</Button>} />

      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Routers registrados</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.length===0 && <div className="text-sm text-muted-foreground">Aún no registras Mikrotiks.</div>}
          {devices.map(d=>(
            <div key={d.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Router className="w-4 h-4 text-primary" />
                <div className="font-medium">{d.name}</div>
                <Badge variant="outline" className="ml-auto uppercase text-[10px]">{d.connection}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-2">{d.host}{d.port ? `:${d.port}` : ""}</div>
              <div className="text-xs text-muted-foreground mt-1">{d.location}</div>
              <div className="mt-3 flex justify-end">
                <Button size="icon" variant="ghost" onClick={()=>del(d.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Sesiones activas (vinculadas OLT)</div>
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>IP</TableHead><TableHead>Servidor</TableHead>
            <TableHead>Plan</TableHead><TableHead>Consumo</TableHead>
            <TableHead>ONU dBm</TableHead><TableHead>Pago activo</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {onus.length===0 && <EmptyRow colSpan={7} />}
            {onus.map(o=>{
              const c = plans.find(p=>p.id===o.plan_id);
              // days remaining until next_due_date
              const days = o.next_due_date ? differenceInDays(parseISO(o.next_due_date), new Date()) : null;
              const active = days !== null && days >= 0;
              return (
                <TableRow key={o.client_id}>
                  <TableCell className="font-medium">{o.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{o.ip_address}</TableCell>
                  <TableCell>{o.mikrotik_server}</TableCell>
                  <TableCell>{c ? `${c.name} · ${c.speed_mbps}M` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{o.rx_mbps}↓ / {o.tx_mbps}↑ Mbps</TableCell>
                  <TableCell className="font-mono">{o.power_dbm}</TableCell>
                  <TableCell>
                    {active
                      ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Activo · {days}d</Badge>
                      : <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">Vencido</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <FormDialog open={open} onOpenChange={setOpen} title="Registrar Mikrotik"
        fields={fields} initial={{connection:"public_ip"}} onSubmit={save} />

      <VpnPanel mikrotiks={devices} />
    </div>
  );
}
