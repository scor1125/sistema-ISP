import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Cpu, Globe2, KeyRound, Pencil, Radio, RefreshCw, ShieldCheck, Terminal,
  Copy, ChevronDown, ChevronUp, Webhook, ServerCog,
} from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const bytesFmt = (n) => {
  const b = Number(n || 0);
  if (!b) return "—";
  const kb = b / 1024;
  const mb = kb / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${kb.toFixed(0)} KB`;
};

const sourceBadge = (src) => {
  const map = {
    webhook: { label: "Webhook (Proton)", cls: "border-emerald-500/40 text-emerald-500" },
    manual: { label: "Manual", cls: "border-sky-500/40 text-sky-500" },
    env: { label: "Env (.env)", cls: "border-muted-foreground/30 text-muted-foreground" },
  };
  const it = map[src] || map.env;
  return <Badge variant="outline" className={`text-[10px] ${it.cls}`}>{it.label}</Badge>;
};

const testStatus = (cfg) => {
  if (!cfg?.last_test_at) return { label: "sin probar", cls: "text-muted-foreground" };
  if (cfg.last_test_ok) return { label: "OK", cls: "text-emerald-500" };
  return { label: "FALLÓ", cls: "text-red-500" };
};

function EditDialog({ open, onOpenChange, initial, onSaved }) {
  const [f, setF] = useState({ host: "", port: 8728, user: "", password: "", use_ssl: false });
  useEffect(() => {
    if (open) {
      setF({
        host: initial?.host || "",
        port: initial?.port || 8728,
        user: initial?.user || "",
        password: "",
        use_ssl: !!initial?.use_ssl,
      });
    }
  }, [open, initial]);

  const submit = async () => {
    const patch = {};
    if (f.host.trim()) patch.host = f.host.trim();
    if (f.port) patch.port = Number(f.port);
    if (f.user.trim()) patch.user = f.user.trim();
    if (f.password.trim()) patch.password = f.password.trim();
    patch.use_ssl = !!f.use_ssl;
    if (Object.keys(patch).length === 1 && "use_ssl" in patch && f.use_ssl === !!initial?.use_ssl) {
      return toast.error("Nada que guardar");
    }
    try {
      await api.patch("/mikrotik/dynamic", patch);
      toast.success("Config guardada");
      onSaved?.();
      onOpenChange(false);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> Editar Mikrotik dinámico
          </DialogTitle>
          <DialogDescription>
            Deja el password vacío para conservar el guardado. El webhook actualizará IP+puerto automáticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">IP / DNS (Proton)</Label>
              <Input
                data-testid="mk-dyn-host"
                value={f.host}
                onChange={(e) => setF({ ...f, host: e.target.value })}
                placeholder="45.83.220.14"
              />
            </div>
            <div>
              <Label className="text-xs">Puerto</Label>
              <Input
                data-testid="mk-dyn-port"
                type="number" min={1} max={65535}
                value={f.port}
                onChange={(e) => setF({ ...f, port: e.target.value })}
                placeholder="45678"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Usuario API</Label>
              <Input
                data-testid="mk-dyn-user"
                value={f.user}
                onChange={(e) => setF({ ...f, user: e.target.value })}
                placeholder="api-emergent"
              />
            </div>
            <div>
              <Label className="text-xs">Password API</Label>
              <Input
                data-testid="mk-dyn-password"
                type="password"
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
                placeholder={initial?.has_password ? "(sin cambios)" : "••••••••"}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Switch
              checked={f.use_ssl}
              onCheckedChange={(v) => setF({ ...f, use_ssl: v })}
              data-testid="mk-dyn-ssl"
            />
            Usar API-SSL (puerto 8729)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} data-testid="mk-dyn-save">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MikrotikDynamicPanel() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/mikrotik/dynamic");
      setCfg(data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post("/mikrotik/dynamic/test");
      setTestResult(data);
      toast.success(
        `Conectado · ${data.board_name || "?"} · CPU ${data.cpu_load ?? "?"}%`,
        { duration: 6000 }
      );
      load();
    } catch (e) {
      toast.error(formatApiError(e), { duration: 8000 });
      load();
    } finally { setTesting(false); }
  };

  const st = testStatus(cfg);
  const backendOrigin = useMemo(() => {
    const url = process.env.REACT_APP_BACKEND_URL || "";
    return url.replace(/\/$/, "");
  }, []);
  const webhookUrl = `${backendOrigin}/api/update-router-ip`;
  const curlExample = useMemo(() => (
`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: <TU_WEBHOOK_CRON_SECRET>" \\
  -d '{"current_ip":"1.2.3.4","current_port":45678}'`
  ), [webhookUrl]);

  const copy = async (txt, label = "Copiado") => {
    try { await copyToClipboard(txt); toast.success(label); }
    catch { toast.error("No pude copiar"); }
  };

  const snap = cfg?.last_test_snapshot || testResult || {};

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden mb-4" data-testid="mk-dyn-panel">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap">
        <ServerCog className="w-4 h-4 text-primary" />
        <div className="font-semibold text-sm">Router dinámico · Proton VPN (CGNAT + Port Forwarding)</div>
        {cfg && sourceBadge(cfg.last_updated_source)}
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button
            size="sm" variant="outline"
            onClick={() => setHelpOpen((x) => !x)}
            data-testid="mk-dyn-help-toggle"
          >
            <Webhook className="w-3.5 h-3.5 mr-1" />
            Webhook
            {helpOpen ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button size="sm" variant="outline" onClick={load} data-testid="mk-dyn-reload">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} data-testid="mk-dyn-edit">
            <Pencil className="w-3.5 h-3.5 mr-1" />
            Editar
          </Button>
          <Button
            size="sm"
            onClick={runTest}
            disabled={testing || !cfg?.host || !cfg?.has_password}
            data-testid="mk-dyn-test"
            title={!cfg?.host ? "Falta IP/DNS" : !cfg?.has_password ? "Falta password API" : "Probar conexión"}
          >
            <Radio className={`w-3.5 h-3.5 mr-1 ${testing ? "animate-pulse" : ""}`} />
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1 flex items-center gap-1">
            <Globe2 className="w-3 h-3" /> IP pública
          </div>
          <div className="font-mono text-lg break-all" data-testid="mk-dyn-current-host">
            {cfg?.host || <span className="text-muted-foreground italic text-sm">sin configurar</span>}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Puerto</div>
          <div className="font-mono text-lg" data-testid="mk-dyn-current-port">{cfg?.port ?? "—"}</div>
          {cfg?.use_ssl && <Badge variant="outline" className="mt-1 text-[10px]">API-SSL</Badge>}
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1 flex items-center gap-1">
            <KeyRound className="w-3 h-3" /> Usuario · Password
          </div>
          <div className="font-mono text-sm truncate">{cfg?.user || <span className="text-muted-foreground italic">—</span>}</div>
          <div className="font-mono text-xs text-muted-foreground truncate">
            {cfg?.has_password ? cfg.password_masked : <span className="text-red-500 italic">sin password</span>}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Último test</div>
          <div className={`text-sm font-semibold ${st.cls}`} data-testid="mk-dyn-status">{st.label}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{fmt(cfg?.last_test_at)}</div>
        </div>
      </div>

      {(testResult || cfg?.last_test_snapshot) && (
        <div className="mx-4 mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-xs uppercase tracking-widest text-emerald-500 font-mono mb-2 flex items-center gap-1">
            <Cpu className="w-3 h-3" /> Snapshot RouterOS
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-muted-foreground">Identity:</span> <span className="font-mono">{snap.identity || "—"}</span></div>
            <div><span className="text-muted-foreground">Board:</span> <span className="font-mono">{snap.board_name || "—"}</span></div>
            <div><span className="text-muted-foreground">Version:</span> <span className="font-mono">{snap.version || "—"}</span></div>
            <div><span className="text-muted-foreground">Uptime:</span> <span className="font-mono">{snap.uptime || "—"}</span></div>
            <div><span className="text-muted-foreground">CPU load:</span> <span className="font-mono">{snap.cpu_load ?? "—"}%</span></div>
            <div><span className="text-muted-foreground">CPU count:</span> <span className="font-mono">{snap.cpu_count || "—"}</span></div>
            <div><span className="text-muted-foreground">RAM libre:</span> <span className="font-mono">{bytesFmt(snap.free_memory)}</span></div>
            <div><span className="text-muted-foreground">RAM total:</span> <span className="font-mono">{bytesFmt(snap.total_memory)}</span></div>
          </div>
          {cfg?.last_test_error && !cfg?.last_test_ok && (
            <div className="mt-2 text-xs text-red-500 font-mono break-words">{cfg.last_test_error}</div>
          )}
        </div>
      )}

      {cfg?.last_test_at && !cfg?.last_test_ok && cfg?.last_test_error && !testResult && (
        <div className="mx-4 mb-4 rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <div className="text-xs uppercase tracking-widest text-red-500 font-mono mb-1">Último error</div>
          <div className="text-xs font-mono break-words">{cfg.last_test_error}</div>
        </div>
      )}

      {helpOpen && (
        <div className="mx-4 mb-4 rounded-md border border-border bg-muted/30 p-4 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <div className="font-semibold">Cómo actualizar IP y puerto automáticamente desde Proton VPN</div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
              1 · Configura las variables iniciales en <span className="font-mono">/app/backend/.env</span>
            </div>
            <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto">
{`MIKROTIK_HOST=""                 # se auto-actualiza vía webhook
MIKROTIK_PORT="8728"             # se auto-actualiza vía webhook
MIKROTIK_USER="api-emergent"
MIKROTIK_PASSWORD="<pass del usuario api-emergent>"
WEBHOOK_CRON_SECRET="ItK8-aqzeO6nr0AEZ4LGcTHPRNveR8UAqUlA6KdY_u0"`}
            </pre>
            <div className="text-[11px] text-muted-foreground italic mt-1">
              Sólo <span className="font-mono">MIKROTIK_USER</span> + <span className="font-mono">MIKROTIK_PASSWORD</span> son
              obligatorios en el .env — la IP y el puerto se actualizan solos vía el webhook.
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1 flex items-center gap-1">
              <Webhook className="w-3 h-3" /> 2 · Endpoint del webhook
            </div>
            <div className="flex items-center gap-2 bg-background border border-border rounded p-2 font-mono text-xs">
              <span className="flex-1 truncate" data-testid="mk-dyn-webhook-url">{webhookUrl}</span>
              <Button size="sm" variant="ghost" onClick={() => copy(webhookUrl, "URL copiada")} data-testid="mk-dyn-webhook-copy">
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Body JSON: <span className="font-mono">{"{ \"current_ip\": \"...\", \"current_port\": 45678 }"}</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1 flex items-center gap-1">
              <Terminal className="w-3 h-3" /> 3 · Ejemplo de llamada (curl)
            </div>
            <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre">
{curlExample}
            </pre>
            <Button size="sm" variant="outline" className="mt-1 h-7 text-[11px]"
              onClick={() => copy(curlExample, "curl copiado")}
              data-testid="mk-dyn-curl-copy">
              <Copy className="w-3 h-3 mr-1" /> Copiar curl
            </Button>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
              4 · Regla NAT (dstnat) sugerida en el Mikrotik
            </div>
            <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre">
{`# Reenviar el puerto forwardeado por Proton al api del router
/ip firewall nat
add chain=dstnat action=dst-nat protocol=tcp \\
    in-interface=<iface_proton_wg> dst-port=45678 \\
    to-addresses=127.0.0.1 to-ports=8728 comment="EnlaceHR-Emergent"

# Usuario dedicado (solo API):
/user group add name=api-emergent-grp policy=api,read,test
/user add name=api-emergent password="<segura>" group=api-emergent-grp
/ip service enable api`}
            </pre>
          </div>
        </div>
      )}

      <EditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={cfg}
        onSaved={load}
      />
    </div>
  );
}
