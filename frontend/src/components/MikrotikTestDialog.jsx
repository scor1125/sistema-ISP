import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Area, AreaChart } from "recharts";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, AlertCircle, Zap, Activity, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function MikrotikTestDialog({ device, open, onOpenChange }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const run = async () => {
    if (!device) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/devices/${device.id}/mikrotik-test`);
      setResult(data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open && device) { setResult(null); run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device?.id]);

  useEffect(() => {
    if (!autoRefresh || !open) return;
    const id = setInterval(() => run(), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, open]);

  const failed = useMemo(() => (result?.checks || []).filter((c) => !c.ok), [result]);

  const last = result?.traffic?.[result.traffic.length - 1];
  const peakRx = useMemo(() => Math.max(0, ...(result?.traffic || []).map((s) => s.rx_kbps)), [result]);
  const peakTx = useMemo(() => Math.max(0, ...(result?.traffic || []).map((s) => s.tx_kbps)), [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Diagnóstico de conexión · {device?.name}
          </DialogTitle>
        </DialogHeader>

        {/* Overall status */}
        <div className={`rounded-md border p-4 ${
          !result ? "border-border bg-muted/20"
          : result.all_ok ? "border-emerald-500/30 bg-emerald-500/10"
          : result.reachable ? "border-amber-500/30 bg-amber-500/10"
          : "border-red-500/30 bg-red-500/10"
        }`}>
          <div className="flex items-center gap-2">
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" />
              : !result ? <Activity className="w-5 h-5" />
              : result.all_ok ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              : result.reachable ? <AlertCircle className="w-5 h-5 text-amber-400" />
              : <XCircle className="w-5 h-5 text-red-400" />}
            <div className="font-medium">
              {loading ? "Probando…"
                : !result ? "Sin resultados aún"
                : result.all_ok ? "Conexión exitosa"
                : result.reachable ? "Endpoint accesible pero faltan datos"
                : "No se pudo conectar"}
            </div>
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              {result?.endpoint || "—"} · {result?.protocol?.toUpperCase() || "—"}
              {result?.latency_ms != null && ` · ${result.latency_ms}ms`}
            </Badge>
          </div>
          {result && <div className="mt-2 text-sm">{result.message}</div>}
        </div>

        {/* Checks list */}
        <div className="mt-4 rounded-md border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Checklist de verificación</div>
            <Badge variant="outline" className="ml-auto text-xs">
              {result ? `${(result.checks||[]).filter(c=>c.ok).length} / ${result.checks?.length || 0}` : "…"}
            </Badge>
          </div>
          <div className="divide-y divide-border">
            {(result?.checks || []).map((c) => (
              <div key={c.name} className="px-3 py-2 flex items-start gap-2 text-sm">
                {c.ok
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.message}</div>
                  {!c.ok && c.fix && (
                    <div className="text-[11px] text-amber-400 mt-0.5">→ {c.fix}</div>
                  )}
                </div>
              </div>
            ))}
            {loading && !result && (
              <div className="px-3 py-6 text-sm text-muted-foreground text-center">Analizando…</div>
            )}
          </div>
        </div>

        {/* Traffic charts */}
        {result?.reachable && result?.traffic?.length > 0 && (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              <div className="text-xs uppercase tracking-widest text-emerald-400 font-mono">Tráfico en vivo · últimos 90s</div>
              <label className="ml-auto text-xs font-mono flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} data-testid="auto-refresh" />
                Auto-actualizar 4s
              </label>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-xs">
              <div><div className="text-muted-foreground uppercase tracking-widest font-mono text-[10px]">RX actual</div><div className="font-mono text-emerald-400">{last?.rx_kbps || 0} kbps</div></div>
              <div><div className="text-muted-foreground uppercase tracking-widest font-mono text-[10px]">TX actual</div><div className="font-mono text-sky-400">{last?.tx_kbps || 0} kbps</div></div>
              <div><div className="text-muted-foreground uppercase tracking-widest font-mono text-[10px]">RX pico</div><div className="font-mono">{peakRx} kbps</div></div>
              <div><div className="text-muted-foreground uppercase tracking-widest font-mono text-[10px]">TX pico</div><div className="font-mono">{peakTx} kbps</div></div>
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={result.traffic}>
                  <defs>
                    <linearGradient id="rxg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="txg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#666" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#666" />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 12 }}
                    labelStyle={{ color: "#aaa" }}
                  />
                  <Area type="monotone" dataKey="rx_kbps" name="RX" stroke="#34d399" fill="url(#rxg)" strokeWidth={2} />
                  <Area type="monotone" dataKey="tx_kbps" name="TX" stroke="#38bdf8" fill="url(#txg)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => run()} disabled={loading} data-testid="retest-btn">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Probar de nuevo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
