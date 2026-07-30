import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Router as RouterIcon, ShieldCheck, Terminal, Copy, Download, Shuffle, ChevronDown, Trash2, Pencil, Zap,
} from "lucide-react";
import { toast } from "sonner";
import MikrotikTestDialog from "@/components/MikrotikTestDialog";

const rand = (n = 10) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

const buildScript = ({ name, protocol, vpnUser, vpnPass, apiEnabled, apiUser, apiPass, modes, server }) => {
  const safeName = (name || "mikrotik-crm").replace(/\s+/g, "-").toLowerCase();
  const iface = protocol === "wireguard" ? `wg-crm-${safeName}`.slice(0, 15) : `l2tp-crm-${safeName}`.slice(0, 15);
  const port = protocol === "wireguard" ? (server?.wireguard_port || 51820) : (server?.l2tp_port || 1701);
  const publicIp = server?.public_ip || "<IP_PUBLICA_DEL_CRM>";
  const serverKey = server?.server_public_key || "<PEGAR_PUBLIC_KEY_DEL_SERVIDOR>";
  const clientIp = server?.client_tunnel_ip || "10.100.0.2/24";
  const tunnelNet = server?.tunnel_network || "10.100.0.0/24";

  let out = `# ============================================================\n`;
  out += `# CRM Jupiter - Script de vinculacion para: ${name || "(sin nombre)"}\n`;
  out += `# Protocolo: ${protocol.toUpperCase()}\n`;
  out += `# Pega este script en /system > New Terminal del Mikrotik.\n`;
  out += `# ============================================================\n\n`;

  if (protocol === "wireguard") {
    out += `# 1) Crear interfaz WireGuard\n`;
    out += `/interface wireguard\n`;
    out += `add name=${iface} listen-port=${port} mtu=1420 comment="CRM-Jupiter"\n\n`;
    out += `# 2) Ver la Public Key del router y pegarla en el CRM (preshared_key)\n`;
    out += `/interface wireguard print\n\n`;
    out += `# 3) Asignar IP del tunel al router\n`;
    out += `/ip address\n`;
    out += `add address=${clientIp} interface=${iface} comment="CRM-Jupiter"\n\n`;
    out += `# 4) Registrar peer del servidor CRM\n`;
    out += `/interface wireguard peers\n`;
    out += `add interface=${iface} \\\n`;
    out += `    endpoint-address=${publicIp} \\\n`;
    out += `    endpoint-port=${port} \\\n`;
    out += `    public-key="${serverKey}" \\\n`;
    out += `    allowed-address=${tunnelNet} \\\n`;
    out += `    persistent-keepalive=25s \\\n`;
    out += `    comment="CRM-Jupiter"\n\n`;
    out += `# 5) Firewall: permitir la VPN entrante\n`;
    out += `/ip firewall filter\n`;
    out += `add chain=input action=accept protocol=udp dst-port=${port} comment="CRM-Jupiter WG"\n\n`;
  } else if (protocol === "l2tp") {
    out += `# 1) Crear cliente L2TP/IPsec\n`;
    out += `/interface l2tp-client\n`;
    out += `add name=${iface} connect-to=${publicIp} user=${vpnUser || "<VPN_USER>"} password=${vpnPass || "<VPN_PASS>"} \\\n`;
    out += `    use-ipsec=yes ipsec-secret=CRM-JUPITER-PSK add-default-route=no comment="CRM-Jupiter"\n\n`;
    out += `# 2) Firewall: L2TP/IPsec\n`;
    out += `/ip firewall filter\n`;
    out += `add chain=input action=accept protocol=udp dst-port=500,4500,1701 comment="CRM-Jupiter L2TP"\n\n`;
  }

  if (apiEnabled) {
    out += `# --- Usuario API para gestion desde el CRM ---\n`;
    out += `/user group\n`;
    out += `add name=crm-jupiter policy=api,read,write,test,winbox,ssh,web,sensitive comment="CRM-Jupiter"\n`;
    out += `/user\n`;
    out += `add name=${apiUser || "crm-api"} password="${apiPass || rand(14)}" group=crm-jupiter comment="CRM-Jupiter"\n`;
    out += `/ip service enable api\n`;
    out += `/ip service enable api-ssl\n\n`;
  }

  if (modes?.includes("ppp")) {
    out += `# --- Modo PPP: perfil base gestionado por CRM ---\n`;
    out += `/ppp profile\n`;
    out += `add name=crm-default local-address=10.10.0.1 dns-server=${server?.dns || "1.1.1.1"} comment="CRM-Jupiter"\n`;
    out += `# El CRM creara secretos PPP por cliente automaticamente.\n\n`;
  }
  if (modes?.includes("queues")) {
    out += `# --- Modo Queues: preparar tree base ---\n`;
    out += `/queue simple\n`;
    out += `# El CRM creara /queue simple por cliente con el plan contratado.\n\n`;
  }

  out += `# --- Verificacion ---\n`;
  if (protocol === "wireguard") {
    out += `/interface wireguard peers print\n`;
    out += `/ip address print where interface=${iface}\n`;
  } else {
    out += `/interface l2tp-client print\n`;
  }
  if (apiEnabled) out += `/user print where name=${apiUser || "crm-api"}\n`;
  return out;
};

const emptyForm = () => ({
  name: "",
  vpn_protocol: "wireguard",
  vpn_user: "",
  vpn_password: "",
  api_enabled: false,
  api_user: "",
  api_password: "",
  management_modes: [],
});

function MikrotikWizard({ open, onOpenChange, server, onSaved, initial }) {
  const [f, setF] = useState(emptyForm());
  useEffect(() => { setF(initial ? { ...emptyForm(), ...initial } : emptyForm()); }, [initial, open]);

  const script = useMemo(() => buildScript({
    name: f.name, protocol: f.vpn_protocol,
    vpnUser: f.vpn_user, vpnPass: f.vpn_password,
    apiEnabled: f.api_enabled, apiUser: f.api_user, apiPass: f.api_password,
    modes: f.management_modes, server,
  }), [f, server]);

  const filename = `crm-jupiter-${(f.name || "mikrotik").replace(/\s+/g, "-").toLowerCase()}.rsc`;

  const genVpn = () => setF((p) => ({
    ...p,
    vpn_user: `crm-${rand(6).toLowerCase()}`,
    vpn_password: rand(14),
  }));
  const genApi = () => setF((p) => ({
    ...p,
    api_user: p.api_user || "crm-api",
    api_password: rand(16),
  }));

  const toggleMode = (m) => setF((p) => ({
    ...p,
    management_modes: p.management_modes.includes(m)
      ? p.management_modes.filter((x) => x !== m)
      : [...p.management_modes, m],
  }));

  const copy = async () => { await navigator.clipboard.writeText(script); toast.success("Script copiado"); };
  const download = () => {
    const blob = new Blob([script], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  };

  const submit = async () => {
    if (!f.name.trim()) return toast.error("Ponle un nombre al router");
    try {
      const payload = {
        name: f.name,
        kind: "mikrotik",
        host: server?.public_ip || "-",
        port: f.vpn_protocol === "wireguard" ? (server?.wireguard_port || 51820) : (server?.l2tp_port || 1701),
        connection: "vpn",
        vpn_protocol: f.vpn_protocol,
        vpn_user: f.vpn_user,
        vpn_password: f.vpn_password,
        api_enabled: f.api_enabled,
        api_user: f.api_user,
        api_password: f.api_password,
        management_modes: f.management_modes,
      };
      if (initial?.id) {
        await api.patch(`/devices/${initial.id}`, payload);
        toast.success("Mikrotik actualizado");
      } else {
        await api.post("/devices", payload);
        toast.success("Mikrotik registrado. Copia el script en tu router.");
      }
      onSaved?.(); onOpenChange(false);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {initial ? `Reconfigurar · ${initial.name}` : "Nuevo Mikrotik · VPN/Túnel"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left: form */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <Label className="text-xs">Nombre del router</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                placeholder="Ej: MK-Torre-Norte" data-testid="mk-name" />
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Protocolo VPN</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: "wireguard", label: "WireGuard", tag: "Rápido, recomendado" },
                  { v: "l2tp", label: "L2TP / IPsec", tag: "Compatible con equipos antiguos" },
                ].map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setF({ ...f, vpn_protocol: p.v })}
                    data-testid={`proto-${p.v}`}
                    className={`text-left rounded-md border p-3 transition-colors ${
                      f.vpn_protocol === p.v
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="text-[11px] text-muted-foreground">{p.tag}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Usuario VPN</div>
                <Button size="sm" variant="outline" onClick={genVpn} className="ml-auto h-7 text-xs" data-testid="gen-vpn-btn">
                  <Shuffle className="w-3 h-3 mr-1" /> Autogenerar
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="usuario" value={f.vpn_user}
                  onChange={(e) => setF({ ...f, vpn_user: e.target.value })} data-testid="vpn-user" />
                <Input placeholder="contraseña" value={f.vpn_password}
                  onChange={(e) => setF({ ...f, vpn_password: e.target.value })} data-testid="vpn-pass" />
              </div>
              {f.vpn_protocol === "wireguard" && (
                <div className="text-[11px] text-muted-foreground italic">
                  WireGuard usa llaves en lugar de usuario/contraseña. El router mostrará su Public Key con `/interface wireguard print`.
                </div>
              )}
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Usuario API</div>
                <Switch checked={f.api_enabled} onCheckedChange={(v) => setF({ ...f, api_enabled: v })}
                  className="ml-auto" data-testid="api-toggle" />
              </div>
              {f.api_enabled && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="usuario API" value={f.api_user}
                      onChange={(e) => setF({ ...f, api_user: e.target.value })} data-testid="api-user" />
                    <Input placeholder="contraseña API" value={f.api_password}
                      onChange={(e) => setF({ ...f, api_password: e.target.value })} data-testid="api-pass" />
                  </div>
                  <Button size="sm" variant="outline" onClick={genApi} className="h-7 text-xs" data-testid="gen-api-btn">
                    <Shuffle className="w-3 h-3 mr-1" /> Generar credenciales API
                  </Button>
                </>
              )}
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Modo de gestión</div>
              <div className="space-y-2">
                {[
                  { v: "ppp", label: "PPP", desc: "El CRM crea secretos PPP por cliente para autenticación." },
                  { v: "queues", label: "Queues", desc: "El CRM crea simple queues según el plan contratado." },
                ].map((m) => (
                  <label key={m.v} className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={f.management_modes.includes(m.v)}
                      onCheckedChange={() => toggleMode(m.v)}
                      data-testid={`mode-${m.v}`}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Right: live script */}
          <div className="lg:col-span-3">
            <div className="rounded-md border border-border overflow-hidden h-full flex flex-col">
              <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" />
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Script listo para pegar en Mikrotik</div>
                <Badge variant="outline" className="ml-auto font-mono text-[10px]">{filename}</Badge>
              </div>
              <pre className="text-xs p-3 font-mono whitespace-pre overflow-auto flex-1 max-h-[70vh]" data-testid="wizard-script">{script}</pre>
              <div className="p-2 border-t border-border flex gap-2">
                <Button size="sm" variant="outline" onClick={copy} data-testid="wizard-copy"><Copy className="w-3.5 h-3.5 mr-1" /> Copiar</Button>
                <Button size="sm" variant="outline" onClick={download} data-testid="wizard-download"><Download className="w-3.5 h-3.5 mr-1" /> Descargar .rsc</Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} data-testid="wizard-save">
            {initial ? "Guardar cambios" : "Crear Mikrotik"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Mikrotik() {
  const [devices, setDevices] = useState([]);
  const [server, setServer] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [q, setQ] = useState("");

  const load = async () => {
    const [d, s] = await Promise.all([api.get("/devices"), api.get("/vpn/server-info")]);
    setDevices(d.data.filter((x) => x.kind === "mikrotik"));
    setServer(s.data);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return devices;
    return devices.filter((d) =>
      norm(`${d.name} ${d.vpn_protocol} ${d.vpn_user} ${d.api_user} ${(d.management_modes||[]).join(" ")}`).includes(nq)
    );
  }, [devices, q]);

  const startNew = () => { setEditing(null); setWizardOpen(true); };
  const startEdit = (d) => { setEditing(d); setWizardOpen(true); };
  const del = async (id) => {
    if (!window.confirm("¿Eliminar este Mikrotik?")) return;
    try { await api.delete(`/devices/${id}`); toast.success("Eliminado"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Mikrotik"
        subtitle="Vincula tus routers Mikrotik con el CRM en minutos: crea la VPN, generá el usuario API y elegí el modo de gestión (PPP o Queues)."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="new-mk-btn">
                <Plus className="w-4 h-4 mr-1" /> Nuevo Mikrotik
                <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Elegí el tipo de vinculación</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startNew} data-testid="opt-vpn-tunnel">
                <ShieldCheck className="w-4 h-4 mr-2 text-primary" />
                <div>
                  <div className="font-medium text-sm">VPN / Túnel</div>
                  <div className="text-[11px] text-muted-foreground">Genera un script auto para WireGuard o L2TP</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <SearchBar value={q} onChange={setQ} placeholder="Buscar Mikrotik por nombre, protocolo o modo…"
        hint={`${filtered.length} / ${devices.length}`} testId="mk-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Protocolo</TableHead>
            <TableHead>Usuario VPN</TableHead>
            <TableHead>Usuario API</TableHead>
            <TableHead>Modo gestión</TableHead>
            <TableHead>Creado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <EmptyRow colSpan={7} text={devices.length === 0
                ? "Aún no registras Mikrotiks. Presiona '+ Nuevo Mikrotik' y elige VPN/Túnel."
                : "Nada coincide con la búsqueda."} />
            )}
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium"><RouterIcon className="w-4 h-4 text-primary inline mr-1" />{d.name}</TableCell>
                <TableCell><Badge variant="outline" className="uppercase text-[10px]">{d.vpn_protocol || "—"}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{d.vpn_user || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.api_enabled ? (d.api_user || "crm-api") : "—"}</TableCell>
                <TableCell>
                  {(d.management_modes || []).length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                  {(d.management_modes || []).map((m) => (
                    <Badge key={m} variant="outline" className="mr-1 uppercase text-[10px]">{m}</Badge>
                  ))}
                </TableCell>
                <TableCell className="text-xs font-mono">{(d.created_at || "").slice(0, 10)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setTesting(d)} data-testid={`mk-test-${d.id}`} className="mr-1">
                    <Zap className="w-3.5 h-3.5 mr-1" /> Probar
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(d)} data-testid={`mk-edit-${d.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => del(d.id)} data-testid={`mk-del-${d.id}`}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MikrotikWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        server={server}
        onSaved={load}
        initial={editing}
      />

      <MikrotikTestDialog
        device={testing}
        open={!!testing}
        onOpenChange={(o) => { if (!o) setTesting(null); }}
      />
    </div>
  );
}
