import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Download, Wifi as WifiIcon, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";

const PROTOCOLS = {
  wireguard: { label: "WireGuard", port: 51820 },
  openvpn: { label: "OpenVPN", port: 1194 },
  l2tp: { label: "L2TP/IPsec", port: 1701 },
  ipsec: { label: "IPsec puro", port: 500 },
};

/**
 * VPN management panel — creates and stores VPN connection profiles so the
 * operator can quickly reach any of their Mikrotik routers. The backend
 * generates a downloadable config; the actual tunnel is established by the
 * router (WireGuard/OpenVPN) or by a companion service the operator runs.
 */
export default function VpnPanel({ mikrotiks }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [configFor, setConfigFor] = useState(null);
  const [configText, setConfigText] = useState("");

  const load = useCallback(async () => {
    try { setItems((await api.get("/vpn")).data); }
    catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => [
    { name: "name", label: "Nombre", required: true, full: true, placeholder: "VPN-Torre-Central" },
    { name: "protocol", label: "Protocolo", type: "select",
      options: Object.entries(PROTOCOLS).map(([v, i]) => ({ value: v, label: i.label })) },
    { name: "mikrotik_id", label: "Mikrotik asociado", type: "select",
      options: mikrotiks.map((m) => ({ value: m.id, label: m.name })),
      hint: mikrotiks.length ? undefined : "Registra un Mikrotik primero." },
    { name: "remote_host", label: "Host remoto", required: true, placeholder: "vpn.miisp.com o 190.10.20.30" },
    { name: "remote_port", label: "Puerto", type: "number", placeholder: "51820" },
    { name: "username", label: "Usuario", placeholder: "opcional (OpenVPN/L2TP)" },
    { name: "preshared_key", label: "Clave / PublicKey", placeholder: "PSK o llave pública WireGuard", full: true },
    { name: "allowed_ips", label: "Allowed IPs", placeholder: "0.0.0.0/0" },
    { name: "dns", label: "DNS", placeholder: "1.1.1.1" },
  ], [mikrotiks]);

  const save = async (v) => {
    try {
      const payload = { ...v };
      if (payload.mikrotik_id === "") payload.mikrotik_id = null;
      if (!payload.remote_port) payload.remote_port = PROTOCOLS[payload.protocol]?.port || 51820;
      await api.post("/vpn", payload);
      toast.success("Conexión VPN creada"); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const generate = async (v) => {
    try {
      const { data } = await api.post(`/vpn/${v.id}/generate-config`);
      setConfigFor({ v, filename: data.filename });
      setConfigText(data.config);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const test = async (v) => {
    try {
      const { data } = await api.post(`/vpn/${v.id}/test`);
      toast.success(`Endpoint alcanzable · ${data.latency_ms}ms`, { description: data.message });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar VPN?")) return;
    try { await api.delete(`/vpn/${id}`); await load(); toast.success("Eliminada"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const download = () => {
    if (!configText || !configFor) return;
    const blob = new Blob([configText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = configFor.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Túneles VPN al Mikrotik</div>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)} data-testid="new-vpn-btn">
          <Plus className="w-4 h-4 mr-1" /> Nueva VPN
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground col-span-full rounded-md border border-border bg-card p-4">
            Aún no tienes VPNs configuradas. Crea una para generar el perfil de conexión y usarlo en tu Mikrotik o cliente WireGuard.
          </div>
        )}
        {items.map((v) => {
          const mk = mikrotiks.find((m) => m.id === v.mikrotik_id);
          const proto = PROTOCOLS[v.protocol] || PROTOCOLS.wireguard;
          return (
            <div key={v.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <WifiIcon className="w-4 h-4 text-primary" />
                <div className="font-medium truncate">{v.name}</div>
                <Badge variant="outline" className="ml-auto text-[10px] uppercase font-mono">{proto.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono mb-1">{v.remote_host}:{v.remote_port}</div>
              {mk && <div className="text-xs text-muted-foreground mb-2">→ {mk.name}</div>}
              <div className="flex gap-1 flex-wrap mt-2">
                <Button size="sm" variant="outline" onClick={() => generate(v)} data-testid={`vpn-config-${v.id}`}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Config
                </Button>
                <Button size="sm" variant="outline" onClick={() => test(v)} data-testid={`vpn-test-${v.id}`}>
                  <Zap className="w-3.5 h-3.5 mr-1" /> Probar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(v.id)} className="ml-auto">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <FormDialog open={open} onOpenChange={setOpen} title="Nueva conexión VPN al Mikrotik"
        fields={fields}
        initial={{ protocol: "wireguard", remote_port: 51820, allowed_ips: "0.0.0.0/0", dns: "1.1.1.1" }}
        onSubmit={save} submitLabel="Crear VPN" size="2xl" />

      <Dialog open={!!configFor} onOpenChange={(v) => { if (!v) setConfigFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Perfil generado · {configFor?.filename}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-80 font-mono">{configText}</pre>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(configText); toast.success("Copiado"); }}>
              Copiar
            </Button>
            <Button onClick={download}><Download className="w-4 h-4 mr-1" /> Descargar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
