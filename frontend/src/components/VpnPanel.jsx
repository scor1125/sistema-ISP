import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Trash2, Download, Wifi as WifiIcon, ShieldCheck, Zap,
  Pencil, CheckCircle2, XCircle, Activity, Signal, ArrowUpFromLine, ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

const PROTOCOLS = {
  wireguard: { label: "WireGuard", port: 51820 },
  openvpn: { label: "OpenVPN", port: 1194 },
  l2tp: { label: "L2TP/IPsec", port: 1701 },
  ipsec: { label: "IPsec puro", port: 500 },
};

const HANDSHAKE_LABELS = {
  ok: "Handshake OK",
  dns_fail: "DNS no resuelve",
  timeout: "Timeout",
  refused: "Rechazada",
  error: "Error",
};

export default function VpnPanel({ mikrotiks }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [configFor, setConfigFor] = useState(null);
  const [configText, setConfigText] = useState("");
  const [testResults, setTestResults] = useState({}); // { [id]: result }
  const [testing, setTesting] = useState({}); // { [id]: bool }
  const [detail, setDetail] = useState(null); // vpn selected for expanded view

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
      if (editing) {
        await api.patch(`/vpn/${editing.id}`, payload);
        toast.success("VPN reconfigurada");
      } else {
        await api.post("/vpn", payload);
        toast.success("Conexión VPN creada");
      }
      setEditing(null); await load();
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
    setTesting((t) => ({ ...t, [v.id]: true }));
    try {
      const { data } = await api.post(`/vpn/${v.id}/test`);
      setTestResults((r) => ({ ...r, [v.id]: data }));
      if (data.reachable) toast.success(`${v.name} · ${data.latency_ms}ms`);
      else toast.error(`${v.name}: ${data.error || "no accesible"}`);
    } catch (e) {
      const err = { reachable: false, error: formatApiError(e), handshake: "error", checked_at: new Date().toISOString() };
      setTestResults((r) => ({ ...r, [v.id]: err }));
      toast.error(formatApiError(e));
    } finally {
      setTesting((t) => ({ ...t, [v.id]: false }));
    }
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

  const openEdit = (v) => { setEditing(v); setOpen(true); };
  const openNew = () => { setEditing(null); setOpen(true); };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Túneles VPN al Mikrotik</div>
        <Button size="sm" className="ml-auto" onClick={openNew} data-testid="new-vpn-btn">
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
          const r = testResults[v.id];
          const isTesting = testing[v.id];
          const statusColor = r
            ? (r.reachable ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                           : "border-red-500/30 text-red-400 bg-red-500/10")
            : "border-border text-muted-foreground bg-muted/30";
          return (
            <div key={v.id} className="rounded-md border border-border bg-card p-4" data-testid={`vpn-card-${v.id}`}>
              <div className="flex items-center gap-2 mb-2">
                <WifiIcon className="w-4 h-4 text-primary" />
                <div className="font-medium truncate">{v.name}</div>
                <Badge variant="outline" className="ml-auto text-[10px] uppercase font-mono">{proto.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono mb-1">{v.remote_host}:{v.remote_port}</div>
              {mk && <div className="text-xs text-muted-foreground mb-2">→ {mk.name}</div>}

              {/* Live status */}
              <div className={`rounded-md border ${statusColor} p-2 mt-2 text-xs`}>
                <div className="flex items-center gap-1.5 font-mono">
                  {isTesting ? (
                    <><Activity className="w-3.5 h-3.5 animate-pulse" /> Probando…</>
                  ) : !r ? (
                    <><Signal className="w-3.5 h-3.5" /> Sin datos — presiona Probar</>
                  ) : r.reachable ? (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> {HANDSHAKE_LABELS[r.handshake] || "OK"} · {r.latency_ms}ms</>
                  ) : (
                    <><XCircle className="w-3.5 h-3.5" /> {HANDSHAKE_LABELS[r.handshake] || "Error"}</>
                  )}
                </div>
                {r && !r.reachable && r.error && (
                  <div className="mt-1 text-[11px] leading-snug">{r.error}</div>
                )}
                {r && r.reachable && r.traffic && (
                  <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" />{r.traffic.rx_kbps} kbps</span>
                    <span className="inline-flex items-center gap-1"><ArrowUpFromLine className="w-3 h-3" />{r.traffic.tx_kbps} kbps</span>
                  </div>
                )}
              </div>

              <div className="flex gap-1 flex-wrap mt-3">
                <Button size="sm" variant="outline" onClick={() => generate(v)} data-testid={`vpn-config-${v.id}`}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Config
                </Button>
                <Button size="sm" variant="outline" onClick={() => test(v)} disabled={isTesting} data-testid={`vpn-test-${v.id}`}>
                  <Zap className="w-3.5 h-3.5 mr-1" /> {isTesting ? "…" : "Probar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(v)} data-testid={`vpn-edit-${v.id}`}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                </Button>
                {r && (
                  <Button size="sm" variant="ghost" onClick={() => setDetail({ v, r })} data-testid={`vpn-detail-${v.id}`}>
                    <Activity className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove(v.id)} className="ml-auto">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <FormDialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}
        title={editing ? `Reconfigurar VPN · ${editing.name}` : "Nueva conexión VPN al Mikrotik"}
        fields={fields}
        initial={editing || { protocol: "wireguard", remote_port: 51820, allowed_ips: "0.0.0.0/0", dns: "1.1.1.1" }}
        onSubmit={save}
        submitLabel={editing ? "Guardar cambios" : "Crear VPN"}
        size="2xl"
      />

      {/* Config file */}
      <Dialog open={!!configFor} onOpenChange={(v) => { if (!v) setConfigFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Perfil generado · {configFor?.filename}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-80 font-mono">{configText}</pre>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { copyToClipboard(configText); toast.success("Copiado"); }}>
              Copiar
            </Button>
            <Button onClick={download}><Download className="w-4 h-4 mr-1" /> Descargar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              {detail?.v?.name}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Endpoint</div><div className="font-mono">{detail.r.endpoint}</div></div>
                <div><div className="text-xs text-muted-foreground">Protocolo</div><div className="font-mono uppercase">{detail.r.protocol}</div></div>
                <div><div className="text-xs text-muted-foreground">IP resuelta</div><div className="font-mono">{detail.r.resolved || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Latencia</div><div className="font-mono">{detail.r.latency_ms != null ? `${detail.r.latency_ms} ms` : "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Handshake</div><div>{HANDSHAKE_LABELS[detail.r.handshake] || detail.r.handshake}</div></div>
                <div><div className="text-xs text-muted-foreground">Probado</div><div className="font-mono text-xs">{(detail.r.checked_at || "").slice(0,16).replace("T"," ")}</div></div>
              </div>
              {detail.r.reachable && detail.r.traffic && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="text-xs uppercase tracking-widest text-emerald-400 font-mono mb-2">Tráfico simulado</div>
                  <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                    <div className="flex items-center gap-2"><ArrowDownToLine className="w-4 h-4" /> RX: {detail.r.traffic.rx_kbps} kbps</div>
                    <div className="flex items-center gap-2"><ArrowUpFromLine className="w-4 h-4" /> TX: {detail.r.traffic.tx_kbps} kbps</div>
                    <div>Paquetes IN: {detail.r.traffic.packets_in}</div>
                    <div>Paquetes OUT: {detail.r.traffic.packets_out}</div>
                  </div>
                </div>
              )}
              {!detail.r.reachable && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 space-y-2">
                  <div className="text-xs uppercase tracking-widest text-red-400 font-mono">Error de conexión</div>
                  <div className="text-sm">{detail.r.error}</div>
                  {detail.r.hint && <div className="text-xs text-muted-foreground italic">Sugerencia: {detail.r.hint}</div>}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => test(detail.v)}><Zap className="w-3.5 h-3.5 mr-1" /> Probar de nuevo</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
