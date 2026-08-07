import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BellRing, Send, Save, Eye, RefreshCw, Info, Search } from "lucide-react";
import { toast } from "sonner";

const VARIABLES = [
  { key: "name", label: "Nombre" },
  { key: "amount", label: "Monto" },
  { key: "due_date", label: "Fecha de vencimiento" },
  { key: "plan", label: "Plan" },
  { key: "portal_url", label: "URL del portal" },
  { key: "phone", label: "Teléfono" },
];

function renderPreview(tpl, ctx) {
  let out = tpl || "";
  Object.entries(ctx || {}).forEach(([k, v]) => {
    out = out.split(`{{${k}}}`).join(String(v));
  });
  return out;
}

export default function Recordatorios() {
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState({ clients: [], count: 0, n_days: 3 });
  const [days, setDays] = useState(3);
  const [template, setTemplate] = useState("");
  const [selected, setSelected] = useState({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await api.get("/reminders/config");
      setConfig(data);
      setTemplate(data.template || "");
      setDays(data.days_before || 3);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  const loadPreview = useCallback(async (n) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/reminders/preview`, { params: { days_before: n } });
      setPreview(data);
      // pre-select all by default
      const sel = {};
      data.clients.forEach(c => { sel[c.id] = true; });
      setSelected(sel);
    } catch (e) { toast.error(formatApiError(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { if (config) loadPreview(days); }, [config, days, loadPreview]);

  const saveConfig = async () => {
    try {
      const { data } = await api.patch("/reminders/config", {
        template, days_before: Number(days), auto_send: config?.auto_send ?? false,
        active_hours_start: config?.active_hours_start ?? 9,
        active_hours_end: config?.active_hours_end ?? 19,
      });
      setConfig(data);
      toast.success("Plantilla y días guardados");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const insertVar = (v) => setTemplate(t => `${t}{{${v}}}`);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return preview.clients;
    return preview.clients.filter(c =>
      (c.full_name || "").toLowerCase().includes(s) ||
      (c.phone || "").includes(s)
    );
  }, [preview.clients, q]);

  const selectedIds = useMemo(() => filtered.filter(c => selected[c.id]).map(c => c.id), [filtered, selected]);
  const allChecked = filtered.length > 0 && filtered.every(c => selected[c.id]);
  const toggleAll = (v) => {
    const next = { ...selected };
    filtered.forEach(c => { next[c.id] = v; });
    setSelected(next);
  };

  const previewCtx = useMemo(() => {
    const first = preview.clients[0];
    return {
      name: first?.full_name || "Cliente",
      amount: first?.plan_price || "150",
      due_date: first?.due_date || "2026-02-20",
      plan: first?.plan || "Plan Básico",
      portal_url: `${window.location.origin}/portal`,
      phone: first?.phone || "5551234567",
    };
  }, [preview]);

  const send = async (auto) => {
    const ids = auto ? filtered.map(c => c.id) : selectedIds;
    if (!ids.length) { toast.error("Selecciona al menos un cliente"); return; }
    if (!confirm(`¿Enviar recordatorio a ${ids.length} cliente(s) por WhatsApp?`)) return;
    setSending(true);
    try {
      const { data } = await api.post("/reminders/send", {
        client_ids: ids, template, kind: "reminder",
      });
      toast.success(`Enviados: ${data.sent} · Omitidos: ${data.skipped}`);
      loadPreview(days);
    } catch (e) { toast.error(formatApiError(e)); }
    setSending(false);
  };

  return (
    <div>
      <PageHeader
        title="Recordatorios de pago"
        subtitle="Envía por WhatsApp recordatorios masivos o selectivos, con plantilla personalizada y días editables."
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: template + config */}
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BellRing className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold">Plantilla del mensaje</div>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {VARIABLES.map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  data-testid={`insert-var-${v.key}`}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary transition-colors"
                >
                  {"{{"}{v.key}{"}}"}
                </button>
              ))}
            </div>
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={6}
              className="text-xs font-mono"
              data-testid="reminder-template"
              placeholder="Hola {{name}}, tu pago vence el {{due_date}}…"
            />
            <div className="flex items-center gap-2 mt-3">
              <div>
                <Label className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Días antes</Label>
                <Input
                  data-testid="reminder-days"
                  type="number"
                  min="0" max="30"
                  value={days}
                  onChange={(e) => setDays(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className="w-24 mt-1"
                />
              </div>
              <Button size="sm" variant="outline" onClick={saveConfig} data-testid="reminder-save-config" className="ml-auto">
                <Save className="w-3 h-3 mr-1" /> Guardar plantilla y días
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold">Vista previa</div>
            </div>
            <div className="rounded-md border border-border bg-emerald-500/5 p-3 text-xs whitespace-pre-wrap font-mono">
              {renderPreview(template, previewCtx) || "Escribe tu plantilla arriba…"}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
              <Info className="w-3 h-3" /> Basado en el primer cliente de la lista.
            </div>
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-xs text-amber-300 space-y-1">
            <div className="font-semibold">Recordatorio automático</div>
            <div className="text-amber-100/80">
              El cron <code>send-reminders</code> corre diariamente en horario 9–19 hs y envía recordatorios a clientes cuyo pago
              vence exactamente en <b>{days} día(s)</b>. Configura el cron desde <code>/app/.emergent/crons.yml</code>.
            </div>
          </div>
        </div>

        {/* Right: client list */}
        <div className="lg:col-span-3 rounded-md border border-border bg-card flex flex-col min-h-[70vh]">
          <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o teléfono…"
              className="h-8 max-w-xs text-xs"
              data-testid="reminder-search"
            />
            <Badge variant="outline" className="font-mono">
              {preview.count} clientes vencen en ≤ {preview.n_days} días
            </Badge>
            <Button size="sm" variant="outline" onClick={() => loadPreview(days)} disabled={loading} data-testid="reminder-refresh">
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refrescar
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selectedIds.length} seleccionados</span>
              <Button size="sm" variant="outline" onClick={() => send(false)} disabled={sending || selectedIds.length === 0} data-testid="reminder-send-selected">
                <Send className="w-3 h-3 mr-1" /> Enviar a seleccionados
              </Button>
              <Button size="sm" onClick={() => send(true)} disabled={sending || filtered.length === 0} data-testid="reminder-send-all">
                <Send className="w-3 h-3 mr-1" /> Enviar a todos ({filtered.length})
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(!!v)} data-testid="reminder-toggle-all" />
                  </TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Días</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">
                      No hay clientes con vencimiento en los próximos {days} días.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((c) => (
                  <TableRow key={c.id} data-testid={`reminder-row-${c.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={!!selected[c.id]}
                        onCheckedChange={(v) => setSelected(s => ({ ...s, [c.id]: !!v }))}
                        data-testid={`reminder-check-${c.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell className="font-mono text-xs">{c.phone || "—"}</TableCell>
                    <TableCell className="text-xs">{c.due_date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={c.days_left <= 0 ? "bg-red-500/10 border-red-500/40 text-red-300" : c.days_left <= 1 ? "bg-amber-500/10 border-amber-500/40 text-amber-300" : "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"}>
                        {c.days_left <= 0 ? "vencido" : `${c.days_left} d`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
