import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError, API } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Send, MessageCircle, Bot, QrCode, Settings2, Plus, Trash2, RefreshCw,
  CheckCircle2, XCircle, Copy, Pencil, ArrowRightCircle, UserCog, Search,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "react-qr-code";

const PROVIDERS = [
  { value: "simulated", label: "Simulado (sin conexión real)" },
  { value: "baileys", label: "Baileys (auto-hosted /qr /send /status)" },
  { value: "evolution", label: "Evolution API" },
  { value: "waha", label: "WAHA" },
  { value: "wasenderapi", label: "WasenderAPI" },
  { value: "custom", label: "Custom (Baileys-compatible)" },
];

function norm(str = "") {
  return String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function StatusBadge({ status }) {
  if (!status) return null;
  const connected = status.connected;
  const mode = status.mode;
  const label = mode === "simulated"
    ? "Simulado"
    : connected ? "WhatsApp conectado" : "Desconectado";
  const cls = mode === "simulated"
    ? "bg-slate-500/15 text-slate-300 border-slate-500/40"
    : connected
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : "bg-red-500/15 text-red-300 border-red-500/40";
  return (
    <Badge variant="outline" data-testid="wa-status-badge" className={`gap-1.5 ${cls}`}>
      {connected ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </Badge>
  );
}

// ---------- Config dialog ----------
function ConfigDialog({ open, onClose, config, onSaved }) {
  const [form, setForm] = useState({
    provider: "simulated", base_url: "", api_key: "", instance: "", webhook_token: "",
  });
  useEffect(() => {
    if (open && config) {
      setForm({
        provider: config.provider || "simulated",
        base_url: config.base_url || "",
        api_key: "",
        instance: config.instance || "",
        webhook_token: config.webhook_token || "",
      });
    }
  }, [open, config]);

  const webhookUrl = `${API}/whatsapp/webhook`;

  const save = async () => {
    try {
      const payload = { ...form };
      if (!payload.api_key) delete payload.api_key;  // don't overwrite with empty
      const r = await api.patch("/whatsapp/config", payload);
      toast.success("Configuración guardada");
      onSaved(r.data);
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const genToken = () => {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, "0")).join("");
    setForm(f => ({ ...f, webhook_token: t }));
  };

  const copy = (text) => { navigator.clipboard.writeText(text); toast("Copiado"); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar proveedor WhatsApp</DialogTitle>
          <DialogDescription>
            Conecta tu instancia auto-hospedada (Baileys / Evolution / WAHA) o déjalo en simulado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-mono text-muted-foreground">Proveedor</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
              value={form.provider}
              onChange={(e) => setForm(f => ({ ...f, provider: e.target.value }))}
              data-testid="wa-cfg-provider"
            >
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {form.provider !== "simulated" && (
            <>
              <div>
                <label className="text-xs font-mono text-muted-foreground">Base URL del proveedor</label>
                <Input
                  placeholder="https://mi-baileys.example.com"
                  value={form.base_url}
                  onChange={(e) => setForm(f => ({ ...f, base_url: e.target.value }))}
                  data-testid="wa-cfg-base-url"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-muted-foreground">Nombre de instancia / sesión</label>
                  <Input
                    placeholder="default"
                    value={form.instance}
                    onChange={(e) => setForm(f => ({ ...f, instance: e.target.value }))}
                    data-testid="wa-cfg-instance"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground">
                    API Key {config?.api_key_masked && <span className="ml-1 text-emerald-400">(actual: {config.api_key_masked})</span>}
                  </label>
                  <Input
                    type="password"
                    placeholder="Deja vacío para conservar"
                    value={form.api_key}
                    onChange={(e) => setForm(f => ({ ...f, api_key: e.target.value }))}
                    data-testid="wa-cfg-api-key"
                  />
                </div>
              </div>
              <div className="rounded-md border border-border p-3 bg-secondary/40 space-y-2">
                <div className="text-xs font-mono text-muted-foreground">Configura tu proveedor con esta URL de webhook:</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono px-2 py-1.5 rounded bg-background border border-border truncate">{webhookUrl}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(webhookUrl)}><Copy className="w-3 h-3" /></Button>
                </div>
                <div className="text-xs font-mono text-muted-foreground pt-1">Token secreto (header <code>X-Webhook-Token</code>)</div>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.webhook_token}
                    onChange={(e) => setForm(f => ({ ...f, webhook_token: e.target.value }))}
                    className="font-mono text-xs h-9"
                    data-testid="wa-cfg-webhook-token"
                  />
                  <Button size="sm" variant="outline" onClick={genToken}><RefreshCw className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => copy(form.webhook_token)}><Copy className="w-3 h-3" /></Button>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} data-testid="wa-cfg-save">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- QR dialog ----------
function QrDialog({ open, onClose, onStatusChange }) {
  const [qr, setQr] = useState(null);
  const [mode, setMode] = useState("simulated");
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [qResp, sResp] = await Promise.all([api.get("/whatsapp/qr"), api.get("/whatsapp/status")]);
      setQr(qResp.data.qr);
      setMode(qResp.data.mode);
      setMsg(qResp.data.message || qResp.data.error || "");
      setStatus(sResp.data);
      onStatusChange?.(sResp.data);
    } catch (e) { toast.error(formatApiError(e)); }
    setLoading(false);
  }, [onStatusChange]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [open, refresh]);

  const disconnect = async () => {
    try {
      await api.post("/whatsapp/disconnect");
      toast.success("Desconectado");
      refresh();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const isBase64Image = qr && typeof qr === "string" && qr.startsWith("data:image");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp por QR</DialogTitle>
          <DialogDescription>
            Abre WhatsApp → Menú → <b>Dispositivos vinculados</b> → <b>Vincular dispositivo</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <StatusBadge status={status} />
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refrescar
            </Button>
          </div>
          <div className="rounded-md border border-border bg-white p-4 flex items-center justify-center min-h-[280px]">
            {mode === "simulated" ? (
              <div className="text-center text-slate-700 text-sm px-4">
                <QrCode className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                <div className="font-medium mb-1">Modo simulado</div>
                <div className="text-xs">{msg || "Configura un proveedor para habilitar el QR real."}</div>
              </div>
            ) : status?.connected ? (
              <div className="text-center text-emerald-700">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                <div className="text-sm font-semibold">Conectado como {status.user_jid || "usuario"}</div>
              </div>
            ) : qr ? (
              isBase64Image
                ? <img src={qr} alt="QR" className="w-64 h-64" data-testid="wa-qr-img" />
                : <QRCode value={qr} size={256} data-testid="wa-qr-svg" />
            ) : (
              <div className="text-center text-slate-500 text-sm">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                Esperando código QR del proveedor…
                {msg && <div className="text-xs mt-2 text-red-600">{msg}</div>}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          {status?.connected && (
            <Button variant="destructive" onClick={disconnect} data-testid="wa-disconnect">
              <XCircle className="w-4 h-4 mr-1" /> Desconectar
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- New funnel dialog ----------
function FunnelDialog({ open, onClose, onSaved, funnel }) {
  const [form, setForm] = useState({ name: "", color: "#f59e0b" });
  useEffect(() => {
    if (open) setForm(funnel ? { name: funnel.name, color: funnel.color || "#f59e0b" } : { name: "", color: "#f59e0b" });
  }, [open, funnel]);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      if (funnel) {
        await api.patch(`/whatsapp/funnels/${funnel.id}`, form);
      } else {
        await api.post("/whatsapp/funnels", form);
      }
      toast.success("Embudo guardado");
      onSaved();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{funnel ? "Editar embudo" : "Nuevo embudo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-mono text-muted-foreground">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ej: En cobranza"
              autoFocus
              data-testid="wa-funnel-name"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground">Color</label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))} className="w-12 h-9 rounded border border-input bg-transparent" />
              <span className="text-xs font-mono">{form.color}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} data-testid="wa-funnel-save">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main component ----------
export default function WhatsApp() {
  const [params] = useSearchParams();
  const preselectClient = params.get("client");
  const [messages, setMessages] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [funnels, setFunnels] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [q, setQ] = useState("");
  const [activePhone, setActivePhone] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("chat");
  const [showConfig, setShowConfig] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [funnelDialog, setFunnelDialog] = useState({ open: false, funnel: null });

  const loadAll = useCallback(async () => {
    try {
      const [m, c, u, f, cv] = await Promise.all([
        api.get("/whatsapp/messages"),
        api.get("/clients"),
        api.get("/users").catch(() => ({ data: [] })),
        api.get("/whatsapp/funnels"),
        api.get("/whatsapp/conversations"),
      ]);
      setMessages(m.data); setClients(c.data); setUsers(u.data);
      setFunnels(f.data); setConversations(cv.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const r = await api.get("/whatsapp/config");
      setConfig(r.data);
    } catch (_) { /* non-admins */ }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get("/whatsapp/status");
      setStatus(r.data);
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => { loadAll(); loadConfig(); loadStatus(); }, [loadAll, loadConfig, loadStatus]);
  useEffect(() => {
    const t = setInterval(() => { loadAll(); loadStatus(); }, 15000);
    return () => clearInterval(t);
  }, [loadAll, loadStatus]);

  useEffect(() => {
    if (preselectClient && clients.length && !activePhone) {
      const c = clients.find(x => x.id === preselectClient);
      if (c?.phone) setActivePhone(c.phone);
    }
  }, [preselectClient, clients, activePhone]);

  // Build conversation index (from messages) enriched with funnel/assignment
  const convByPhone = useMemo(() => {
    const map = new Map();
    // Base metadata from conversations collection
    conversations.forEach(cv => {
      map.set(cv.phone, {
        phone: cv.phone,
        funnel_id: cv.funnel_id,
        assigned_to: cv.assigned_to,
        tags: cv.tags || [],
        last_body: cv.last_body,
        updated_at: cv.updated_at,
        msgs: [],
      });
    });
    // Attach messages
    messages.forEach(m => {
      if (!map.has(m.phone)) {
        map.set(m.phone, { phone: m.phone, funnel_id: null, assigned_to: null, tags: [], msgs: [] });
      }
      map.get(m.phone).msgs.push(m);
    });
    // Attach client + last
    map.forEach(cv => {
      cv.client = clients.find(c => c.phone === cv.phone) || null;
      cv.msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
      cv.last = cv.msgs[cv.msgs.length - 1] || { body: cv.last_body || "", created_at: cv.updated_at || "" };
      cv.count = cv.msgs.length;
    });
    return map;
  }, [messages, clients, conversations]);

  const convList = useMemo(() => {
    const list = Array.from(convByPhone.values()).sort((a, b) => {
      const ax = a.last?.created_at || a.updated_at || "";
      const bx = b.last?.created_at || b.updated_at || "";
      return bx.localeCompare(ax);
    });
    const nq = norm(q);
    return nq
      ? list.filter(cv => norm(`${cv.client?.full_name || ""} ${cv.phone} ${cv.last?.body || ""} ${(cv.tags || []).join(" ")}`).includes(nq))
      : list;
  }, [convByPhone, q]);

  const defaultFunnelId = useMemo(
    () => funnels.find(f => f.is_default)?.id || funnels[0]?.id || "",
    [funnels]
  );

  const convsByFunnel = useMemo(() => {
    const m = new Map(funnels.map(f => [f.id, []]));
    convList.forEach(cv => {
      const fid = cv.funnel_id && m.has(cv.funnel_id) ? cv.funnel_id : defaultFunnelId;
      if (m.has(fid)) m.get(fid).push(cv);
    });
    return m;
  }, [funnels, convList, defaultFunnelId]);

  const activeConv = activePhone ? convByPhone.get(activePhone) : null;

  const send = async () => {
    if (!activePhone || !body.trim()) return;
    try {
      await api.post("/whatsapp/messages", {
        client_id: activeConv?.client?.id, phone: activePhone, body, direction: "outgoing", kind,
      });
      setBody("");
      toast.success(config?.provider === "simulated" || !config?.base_url ? "Mensaje encolado (simulado)" : "Mensaje enviado");
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const simulateIncoming = async () => {
    if (!activePhone) return;
    await api.post("/whatsapp/simulate-incoming", {
      client_id: activeConv?.client?.id, phone: activePhone, body: "Hola, tengo problemas con internet.", direction: "incoming", kind: "chat",
    });
    toast("Entrante simulado");
    loadAll();
  };

  const moveConv = async (phone, funnel_id) => {
    try {
      await api.patch(`/whatsapp/conversations/${encodeURIComponent(phone)}`, { funnel_id });
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const assignConv = async (phone, assigned_to) => {
    try {
      await api.patch(`/whatsapp/conversations/${encodeURIComponent(phone)}`, { assigned_to: assigned_to || null });
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteFunnel = async (fid) => {
    if (!confirm("¿Eliminar embudo? Las conversaciones se moverán al embudo por defecto.")) return;
    try {
      await api.delete(`/whatsapp/funnels/${fid}`);
      toast.success("Embudo eliminado");
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const userName = (uid) => users.find(u => u.id === uid)?.name || users.find(u => u.id === uid)?.email || "";

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        subtitle="Conecta tu WhatsApp real por QR, etiqueta con quién responde y organiza chats por embudos personalizables."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={status} />
            <Button size="sm" variant="outline" onClick={() => setShowQr(true)} data-testid="wa-open-qr">
              <QrCode className="w-4 h-4 mr-1" /> Conectar (QR)
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowConfig(true)} data-testid="wa-open-config">
              <Settings2 className="w-4 h-4 mr-1" /> Configurar
            </Button>
            <Button size="sm" onClick={() => setFunnelDialog({ open: true, funnel: null })} data-testid="wa-new-funnel">
              <Plus className="w-4 h-4 mr-1" /> Nuevo embudo
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 max-w-md">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, teléfono, texto o etiqueta…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="wa-search"
          className="h-9 text-sm"
        />
      </div>

      {/* Kanban of funnels */}
      <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-3 overflow-x-auto pb-3" data-testid="wa-kanban">
        {funnels.map(f => {
          const list = convsByFunnel.get(f.id) || [];
          return (
            <div key={f.id} className="rounded-md border border-border bg-card flex flex-col min-h-[60vh]" data-testid={`wa-column-${f.id}`}>
              <div className="p-3 border-b border-border flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color || "#f59e0b" }} />
                <div className="text-sm font-semibold">{f.name}</div>
                {f.is_default && <Badge variant="outline" className="text-[9px] px-1 py-0">default</Badge>}
                <Badge variant="outline" className="ml-auto font-mono text-xs">{list.length}</Badge>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setFunnelDialog({ open: true, funnel: f })} data-testid={`wa-edit-funnel-${f.id}`}>
                  <Pencil className="w-3 h-3" />
                </button>
                {!f.is_default && (
                  <button className="text-muted-foreground hover:text-red-400" onClick={() => deleteFunnel(f.id)} data-testid={`wa-delete-funnel-${f.id}`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {list.length === 0 && <div className="text-xs text-muted-foreground p-2 text-center">Sin chats aquí</div>}
                  {list.map(cv => {
                    const lastMsg = cv.msgs[cv.msgs.length - 1];
                    const respondedBy = lastMsg?.direction === "outgoing" ? lastMsg?.responded_by_name : null;
                    return (
                      <div
                        key={cv.phone}
                        className={`rounded-md border border-border p-2.5 bg-secondary/40 hover:bg-secondary transition-colors cursor-pointer ${activePhone === cv.phone ? "ring-2 ring-primary" : ""}`}
                        onClick={() => setActivePhone(cv.phone)}
                        data-testid={`wa-conv-${cv.phone}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{cv.client?.full_name || cv.phone}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate">{cv.phone}</div>
                          </div>
                          <Badge variant="outline" className="text-[9px] px-1">{cv.count}</Badge>
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                          {cv.last?.body || "Sin mensajes aún"}
                        </div>
                        <div className="mt-2 flex items-center gap-1 flex-wrap">
                          {respondedBy && (
                            <Badge variant="outline" className="text-[9px] px-1 gap-1 bg-emerald-500/10 border-emerald-500/40 text-emerald-300">
                              <UserCog className="w-2.5 h-2.5" /> {respondedBy}
                            </Badge>
                          )}
                          {cv.assigned_to && (
                            <Badge variant="outline" className="text-[9px] px-1 bg-sky-500/10 border-sky-500/40 text-sky-300">
                              @{userName(cv.assigned_to)}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-1">
                          <select
                            className="flex-1 h-7 rounded border border-input bg-background px-1 text-[10px] font-mono"
                            value={cv.funnel_id || defaultFunnelId}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { e.stopPropagation(); moveConv(cv.phone, e.target.value); }}
                            data-testid={`wa-move-${cv.phone}`}
                          >
                            {funnels.map(ff => <option key={ff.id} value={ff.id}>{ff.name}</option>)}
                          </select>
                          <ArrowRightCircle className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          );
        })}
        {funnels.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aún no hay embudos. Crea el primero.
          </div>
        )}
      </div>

      {/* Chat sheet */}
      <Sheet open={!!activePhone} onOpenChange={(v) => !v && setActivePhone("")}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              <span>{activeConv?.client?.full_name || activePhone}</span>
              <span className="text-xs text-muted-foreground font-mono ml-1">{activePhone}</span>
            </SheetTitle>
            {activeConv && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select
                  value={activeConv.funnel_id || defaultFunnelId}
                  onChange={(e) => moveConv(activePhone, e.target.value)}
                  className="h-8 rounded border border-input bg-background px-2 text-xs"
                  data-testid="wa-sheet-funnel"
                >
                  {funnels.map(f => <option key={f.id} value={f.id}>Embudo: {f.name}</option>)}
                </select>
                <select
                  value={activeConv.assigned_to || ""}
                  onChange={(e) => assignConv(activePhone, e.target.value)}
                  className="h-8 rounded border border-input bg-background px-2 text-xs"
                  data-testid="wa-sheet-assign"
                >
                  <option value="">Sin asignar</option>
                  {users.map(u => <option key={u.id} value={u.id}>Asignar a {u.name || u.email}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={simulateIncoming} data-testid="wa-sheet-simulate">
                  <Bot className="w-3 h-3 mr-1" /> Simular entrante
                </Button>
              </div>
            )}
          </SheetHeader>

          <ScrollArea className="flex-1 p-4">
            {(!activeConv || activeConv.msgs.length === 0) && (
              <div className="text-sm text-muted-foreground text-center py-10">Sin mensajes en esta conversación.</div>
            )}
            <div className="space-y-2">
              {activeConv?.msgs.map(m => (
                <div key={m.id} className={`max-w-[85%] rounded-md p-2.5 text-sm ${m.direction === "outgoing" ? "bg-primary/10 border border-primary/30 ml-auto" : "bg-secondary border border-border"}`}>
                  <div>{m.body}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground font-mono flex items-center gap-2 flex-wrap">
                    <span>{m.kind}</span>
                    <span>{m.created_at?.slice(11, 16)}</span>
                    <span>{m.status}</span>
                    {m.direction === "outgoing" && m.responded_by_name && (
                      <Badge variant="outline" className="text-[9px] px-1 gap-1 bg-emerald-500/10 border-emerald-500/40 text-emerald-300">
                        <UserCog className="w-2.5 h-2.5" /> {m.responded_by_name}
                      </Badge>
                    )}
                    {m.direction === "incoming" && m.sender_name && (
                      <span className="text-slate-400">de {m.sender_name}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t border-border p-3 space-y-2">
            <div className="flex gap-2">
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded border border-input bg-background px-2 text-xs">
                <option value="chat">Chat</option>
                <option value="reminder">Recordatorio</option>
                <option value="maintenance">Mantenimiento</option>
                <option value="other">Otro</option>
              </select>
              <Textarea placeholder="Escribe un mensaje..." value={body} onChange={(e) => setBody(e.target.value)} rows={2} data-testid="wa-body" className="flex-1" />
              <Button onClick={send} data-testid="wa-send"><Send className="w-4 h-4" /></Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfigDialog open={showConfig} onClose={() => setShowConfig(false)} config={config} onSaved={setConfig} />
      <QrDialog open={showQr} onClose={() => setShowQr(false)} onStatusChange={setStatus} />
      <FunnelDialog
        open={funnelDialog.open}
        funnel={funnelDialog.funnel}
        onClose={() => setFunnelDialog({ open: false, funnel: null })}
        onSaved={loadAll}
      />
    </div>
  );
}
