import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Server, Copy, Pencil, Save, ShieldCheck, Globe, Key, Network } from "lucide-react";
import { toast } from "sonner";

const FIELDS = [
  { key: "public_ip",         label: "IP pública / Host",         icon: Globe,       hint: "El router usará esto como Endpoint (ejemplo: 190.10.20.30 o vpn.miisp.com)" },
  { key: "public_hostname",   label: "Hostname alternativo",      icon: Globe,       hint: "Opcional. Usa DNS si tu IP es dinámica." },
  { key: "wireguard_port",    label: "Puerto WireGuard (UDP)",    icon: Network,     hint: "Debe estar abierto en firewall y NAT del proveedor." },
  { key: "l2tp_port",         label: "Puerto L2TP (UDP)",         icon: Network,     hint: "Sólo si usas L2TP/IPsec." },
  { key: "openvpn_port",      label: "Puerto OpenVPN (UDP)",      icon: Network,     hint: "Sólo si usas OpenVPN." },
  { key: "server_public_key", label: "Public Key del servidor",   icon: Key,         hint: "El router lo pega en `/interface wireguard peers public-key`." },
  { key: "tunnel_network",    label: "Red del túnel",             icon: ShieldCheck, hint: "Rango CIDR de la red interna (ejemplo: 10.100.0.0/24)." },
  { key: "server_tunnel_ip",  label: "IP servidor en el túnel",   icon: ShieldCheck },
  { key: "client_tunnel_ip",  label: "IP recomendada para el router", icon: ShieldCheck, hint: "El router se debe autoasignar dentro de la red del túnel." },
  { key: "dns",               label: "DNS a usar",                icon: Globe },
  { key: "api_endpoint",      label: "URL del CRM (API)",         icon: Server,      hint: "El Mikrotik podrá consumir esta URL en scripts de reporte." },
];

const CONN_STEPS = [
  "Abre tu Mikrotik en Winbox/WebFig y entra al terminal.",
  "En el router, generá el par de llaves WireGuard con `/interface wireguard add name=wg-crm listen-port=51820` y luego `print`.",
  "Copia la Public Key del router y pegala como `preshared_key` en la VPN dentro del CRM.",
  "Agrega el peer del servidor con la Public Key del servidor (arriba) y el Endpoint = IP pública : puerto.",
  "Asigna la IP recomendada al `wg-crm` con `/ip address add`.",
  "En el CRM, presiona 'Probar' en la VPN. Si conecta, verás tráfico simulado; si no, el error indicará qué falta.",
];

export default function ServerInfoPanel() {
  const [info, setInfo] = useState(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get("/vpn/server-info");
      setInfo(data); setDraft(data);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const copy = async (label, value) => {
    if (!value) return toast.error("Sin valor para copiar");
    try { await navigator.clipboard.writeText(String(value)); toast.success(`${label} copiado`); }
    catch { toast.error("No se pudo copiar"); }
  };

  const save = async () => {
    try {
      await api.patch("/vpn/server-info", draft);
      toast.success("Datos del servidor guardados"); setEdit(false); await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!info) return null;

  return (
    <section
      className="mb-6 rounded-md border border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-5"
      data-testid="server-info-panel"
    >
      <div className="flex items-center gap-2 mb-1">
        <Server className="w-4 h-4 text-primary" />
        <div className="font-display font-bold tracking-tight">Datos de este servidor para vincular Mikrotiks</div>
        <Badge variant="outline" className="ml-2 text-[10px] uppercase font-mono">CRM Jupiter</Badge>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setEdit(true)}
          data-testid="edit-server-info-btn"
        >
          <Pencil className="w-3.5 h-3.5 mr-1" /> Editar datos
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Copia estos valores en tu router para que conecte con este servidor. Cada campo tiene botón de copia rápida.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {FIELDS.map((f) => {
          const Icon = f.icon;
          const value = info[f.key];
          const empty = value === "" || value == null;
          return (
            <div key={f.key} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
                <Icon className="w-3 h-3" /> {f.label}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <code className={`text-sm font-mono truncate flex-1 ${empty ? "text-muted-foreground italic" : ""}`}>
                  {empty ? "sin configurar" : String(value)}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copy(f.label, value)}
                  data-testid={`copy-${f.key}`}
                  disabled={empty}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              {f.hint && <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{f.hint}</div>}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Pasos rápidos para sincronizar
        </div>
        <ol className="space-y-1.5 text-sm">
          {CONN_STEPS.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs grid place-items-center flex-shrink-0 font-mono mt-0.5">{CONN_STEPS.indexOf(s) + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <Dialog open={edit} onOpenChange={(o) => { setEdit(o); if (!o) setDraft(info); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Editar datos del servidor</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  data-testid={`input-${f.key}`}
                />
                {f.hint && <div className="text-[11px] text-muted-foreground mt-1">{f.hint}</div>}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setEdit(false); setDraft(info); }}>Cancelar</Button>
            <Button onClick={save} data-testid="save-server-info-btn"><Save className="w-4 h-4 mr-1" /> Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
