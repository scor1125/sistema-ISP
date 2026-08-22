import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Radio, CheckCircle2, XCircle, Loader2, History, ArrowDown, ArrowUp, BarChart3,
} from "lucide-react";

const AXIS = "hsl(240 5% 55%)";
const GRID = "hsl(240 10% 15%)";
const DOWN = "hsl(210 100% 55%)";
const UP = "hsl(160 84% 42%)";
const TT = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

/** Bytes a la unidad que se lea mejor (KB, MB, GB…). */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/* ============================================================
   Ping a la ONU (lanzado desde el router del cliente)
   ============================================================ */
export function PingDialog({ client, open, onOpenChange }) {
  const [state, setState] = useState("idle");
  const [res, setRes] = useState(null);

  const run = useCallback(async () => {
    setState("running"); setRes(null);
    try {
      const { data } = await api.post(`/clients/${client.id}/ping`);
      setRes(data);
      setState(data.ok ? "done" : "error");
    } catch (e) {
      setRes({ reason: formatApiError(e) });
      setState("error");
    }
  }, [client]);

  useEffect(() => { if (open) run(); }, [open, run]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" /> Ping · {client.full_name}
          </DialogTitle>
          <DialogDescription>
            Se lanza desde el router del cliente hacia{" "}
            <span className="font-mono">{client.ip_address || "—"}</span>.
          </DialogDescription>
        </DialogHeader>

        {state === "running" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Haciendo ping…
          </div>
        )}

        {state === "error" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 text-red-500 font-semibold">
              <XCircle className="w-4 h-4" /> No se pudo hacer ping
            </div>
            <div className="text-xs mt-1 text-muted-foreground break-words">{res?.reason}</div>
          </div>
        )}

        {state === "done" && res && (
          <div className="space-y-3">
            <div className={`rounded-md border p-3 text-sm flex items-center gap-2 ${
              res.alive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-red-500/40 bg-red-500/10 text-red-500"}`}>
              {res.alive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {res.alive ? "La ONU responde" : "La ONU no responde"}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["Enviados", res.sent],
                ["Recibidos", res.received],
                ["Pérdida", `${res.packet_loss}%`],
                ["Latencia media", res.avg_rtt || "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border/60 p-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{k}</div>
                  <div className="font-mono">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={run} disabled={state === "running"}>
            {state === "running" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Radio className="w-3.5 h-3.5 mr-1" />}
            Repetir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Auditoría — cambios confirmados sobre el cliente
   ============================================================ */
const OP_LABEL = { create: "Alta", update: "Edición", delete: "Baja" };
const OP_CLS = {
  create: "border-emerald-500/40 text-emerald-500",
  update: "border-sky-500/40 text-sky-400",
  delete: "border-red-500/40 text-red-500",
};

const shortVal = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

export function AuditDialog({ client, open, onOpenChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/clients/${client.id}/audit`);
        setItems(data.items || []);
      } catch { setItems([]); }
      finally { setLoading(false); }
    })();
  }, [open, client]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> Auditoría · {client.full_name}
          </DialogTitle>
          <DialogDescription>
            Cambios confirmados sobre este cliente, del más reciente al más antiguo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Todavía no hay cambios registrados para este cliente.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] ${OP_CLS[it.op] || ""}`}>
                    {OP_LABEL[it.op] || it.op}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(it.at).toLocaleString()}
                  </span>
                  {it.by_name && (
                    <span className="text-xs text-muted-foreground ml-auto">por {it.by_name}</span>
                  )}
                </div>
                {it.changes?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {it.changes.map((ch, i) => (
                      <li key={i} className="text-xs font-mono flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground">{ch.field}:</span>
                        <span className="line-through text-red-400/80">{shortVal(ch.from)}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-emerald-400">{shortVal(ch.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Resumen de consumo (día / semana / mes)
   ============================================================ */
export function ConsumptionDialog({ client, open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data: d } = await api.get(`/clients/${client.id}/consumption`);
        setData(d);
      } catch { setData(null); }
      finally { setLoading(false); }
    })();
  }, [open, client]);

  const series = (data?.series || []).map((s) => ({
    date: s.date.slice(5),
    Bajada: +(s.download_bytes / 1024 / 1024 / 1024).toFixed(3),
    Subida: +(s.upload_bytes / 1024 / 1024 / 1024).toFixed(3),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" /> Consumo · {client.full_name}
          </DialogTitle>
          <DialogDescription>
            Lo que ha consumido este cliente, medido desde los contadores de su cola en el router.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : !data?.has_data ? (
          <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Todavía no hay consumo registrado para este cliente. El sistema va acumulando
            el consumo poco a poco, así que los datos aparecen a partir de ahora.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[["Hoy", data.today], ["Últimos 7 días", data.week], ["Últimos 30 días", data.month]].map(([label, t]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
                  <div className="text-lg font-mono mt-1">{fmtBytes(t.total_bytes)}</div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-1 space-y-0.5">
                    <div className="flex items-center gap-1">
                      <ArrowDown className="w-3 h-3 text-sky-400" /> {fmtBytes(t.download_bytes)}
                    </div>
                    <div className="flex items-center gap-1">
                      <ArrowUp className="w-3 h-3 text-emerald-500" /> {fmtBytes(t.upload_bytes)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2">
                Últimos 14 días (GB)
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="date" stroke={AXIS} fontSize={10} />
                    <YAxis stroke={AXIS} fontSize={10} />
                    <Tooltip contentStyle={TT} formatter={(v) => `${v} GB`} />
                    <Area type="monotone" dataKey="Bajada" stroke={DOWN} fill={DOWN} fillOpacity={0.2} isAnimationActive={false} />
                    <Area type="monotone" dataKey="Subida" stroke={UP} fill={UP} fillOpacity={0.2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
