import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VpnPanel from "@/components/VpnPanel";
import { Plus, Router, Trash2, Terminal, Download, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { differenceInDays, parseISO } from "date-fns";

export default function Mikrotik() {
  const [onus, setOnus] = useState([]);
  const [plans, setPlans] = useState([]);
  const [devices, setDevices] = useState([]);
  const [open, setOpen] = useState(false);
  const [scriptFor, setScriptFor] = useState(null); // { device, protocol, script, steps, filename }
  const [scriptProto, setScriptProto] = useState("wireguard");
  const [scriptLoading, setScriptLoading] = useState(false);
  const [qDevices, setQDevices] = useState("");
  const [qOnus, setQOnus] = useState("");

  const filteredDevices = useMemo(() => {
    const nq = norm(qDevices); if (!nq) return devices;
    return devices.filter((d) => norm(`${d.name} ${d.host} ${d.location} ${d.connection} ${d.notes}`).includes(nq));
  }, [devices, qDevices]);

  const filteredOnus = useMemo(() => {
    const nq = norm(qOnus); if (!nq) return onus;
    return onus.filter((o) => norm(`${o.full_name} ${o.ip_address} ${o.mikrotik_server} ${o.onu_serial}`).includes(nq));
  }, [onus, qOnus]);

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

  const genScript = async (device, protocol = scriptProto) => {
    setScriptLoading(true);
    try {
      const { data } = await api.post(`/devices/${device.id}/mikrotik-script`, null, { params: { protocol } });
      setScriptFor({ device, ...data });
      setScriptProto(protocol);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setScriptLoading(false); }
  };

  const copyScript = async () => {
    if (!scriptFor) return;
    await navigator.clipboard.writeText(scriptFor.script);
    toast.success("Script copiado al portapapeles");
  };

  const downloadScript = () => {
    if (!scriptFor) return;
    const blob = new Blob([scriptFor.script], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = scriptFor.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PageHeader title="Mikrotik"
        subtitle="Panel vinculado con OLT. Muestra IP, consumo, plan y estado de pago. Registra tus routers y conecta vía VPN o IP pública."
        actions={<Button data-testid="new-mk-btn" onClick={()=>setOpen(true)}><Plus className="w-4 h-4 mr-1"/>Nuevo Mikrotik</Button>} />

      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Routers registrados</div>
        <SearchBar value={qDevices} onChange={setQDevices} placeholder="Buscar router por nombre, host o ubicación…"
          hint={`${filteredDevices.length} / ${devices.length}`} testId="mk-search" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.length===0 && <div className="text-sm text-muted-foreground">{devices.length===0 ? "Aún no registras Mikrotiks." : "Nada coincide con la búsqueda."}</div>}
          {filteredDevices.map(d=>(
            <div key={d.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Router className="w-4 h-4 text-primary" />
                <div className="font-medium">{d.name}</div>
                <Badge variant="outline" className="ml-auto uppercase text-[10px]">{d.connection}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-2">{d.host}{d.port ? `:${d.port}` : ""}</div>
              <div className="text-xs text-muted-foreground mt-1">{d.location}</div>
              <div className="mt-3 flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => genScript(d, "wireguard")}
                  data-testid={`mk-script-${d.id}`}
                >
                  <Terminal className="w-3.5 h-3.5 mr-1" /> Script vinculación
                </Button>
                <Button size="icon" variant="ghost" onClick={()=>del(d.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Sesiones activas (vinculadas OLT)</div>
      <SearchBar value={qOnus} onChange={setQOnus} placeholder="Buscar cliente, IP, ONU serial o servidor…"
        hint={`${filteredOnus.length} / ${onus.length}`} testId="mk-sessions-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>IP</TableHead><TableHead>Servidor</TableHead>
            <TableHead>Plan</TableHead><TableHead>Consumo</TableHead>
            <TableHead>ONU dBm</TableHead><TableHead>Pago activo</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filteredOnus.length===0 && <EmptyRow colSpan={7} text={onus.length===0 ? "Sin sesiones. Registra clientes y ONUs." : "Nada coincide con la búsqueda."} />}
            {filteredOnus.map(o=>{
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

      {/* Dialog Script Mikrotik */}
      <Dialog open={!!scriptFor} onOpenChange={(o) => !o && setScriptFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              Script de vinculación · {scriptFor?.device?.name}
            </DialogTitle>
          </DialogHeader>
          {scriptFor && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Protocolo</div>
                <Select
                  value={scriptProto}
                  onValueChange={(v) => { setScriptProto(v); genScript(scriptFor.device, v); }}
                >
                  <SelectTrigger className="w-48" data-testid="script-proto"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wireguard">WireGuard (recomendado)</SelectItem>
                    <SelectItem value="l2tp">L2TP / IPsec</SelectItem>
                    <SelectItem value="openvpn">OpenVPN</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="ml-auto font-mono text-[10px]">{scriptFor.filename}</Badge>
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Pasos para vincular</div>
                <ol className="space-y-1.5 text-sm">
                  {scriptFor.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs grid place-items-center flex-shrink-0 font-mono mt-0.5">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-border bg-muted/20">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Script RouterOS listo para pegar
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={copyScript} data-testid="copy-script-btn">
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copiar
                    </Button>
                    <Button size="sm" onClick={downloadScript} data-testid="download-script-btn">
                      <Download className="w-3.5 h-3.5 mr-1" /> Descargar .rsc
                    </Button>
                  </div>
                </div>
                <pre className="text-xs p-3 overflow-x-auto max-h-96 font-mono whitespace-pre">{scriptLoading ? "Generando…" : scriptFor.script}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
