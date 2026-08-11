import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BatteryFull, BatteryLow, BatteryMedium, Zap, Sun, Home,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, AlertTriangle, Clock,
} from "lucide-react";
import { toast } from "sonner";

function BatteryIcon({ pct }) {
  if (pct == null) return <BatteryLow className="w-8 h-8 text-slate-400" />;
  if (pct >= 66) return <BatteryFull className="w-8 h-8 text-emerald-400" />;
  if (pct >= 33) return <BatteryMedium className="w-8 h-8 text-amber-400" />;
  return <BatteryLow className="w-8 h-8 text-red-400" />;
}

function formatWatt(w) {
  if (w == null) return "—";
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${w.toFixed(0)} W`;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export default function EnergiaRespaldo() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/energia/estado", { params: force ? { force: true } : {} });
      setData(data);
      setLastFetch(new Date().toISOString());
    } catch (e) {
      setError(formatApiError(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 5 minutes as requested.
    const t = setInterval(() => load(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const state = useMemo(() => {
    if (!data) return null;
    const charging = data.charge_w > 5;
    const discharging = data.charge_w < -5;
    return {
      soc: data.soc,
      load_w: data.load_w,
      charge_w: data.charge_w,
      charging,
      discharging,
      updated_at: data.updated_at,
      cached: data.cached,
      device_sn: data.device_sn,
    };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Energía de respaldo"
        subtitle="Estado en tiempo real de tu almacenamiento Growatt · ShinePhone (auto-refresh cada 5 min)"
        actions={
          <div className="flex items-center gap-2">
            {lastFetch && (
              <Badge variant="outline" className="font-mono text-[10px] gap-1">
                <Clock className="w-3 h-3" /> {timeAgo(state?.updated_at || lastFetch)}
                {state?.cached && <span className="text-slate-400 ml-1">(caché)</span>}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => load(true)} disabled={loading} data-testid="energia-refresh">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 mb-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-red-300">No se pudo leer Growatt</div>
            <div className="text-xs text-red-100/80 font-mono mt-1">{error}</div>
            <div className="text-[11px] text-slate-400 mt-2">
              Verifica <code>GROWATT_API_KEY</code>, <code>GROWATT_PLANT_ID</code> y opcionalmente <code>GROWATT_DEVICE_SN</code> en <code>backend/.env</code>.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Battery SOC card */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="energia-card-soc">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Batería</div>
              <div className="text-xs text-muted-foreground mt-0.5">Estado de carga (SOC)</div>
            </div>
            <BatteryIcon pct={state?.soc} />
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <div className={`text-5xl font-bold tracking-tight ${
              state?.soc == null ? "text-slate-500"
              : state.soc >= 66 ? "text-emerald-400"
              : state.soc >= 33 ? "text-amber-400"
              : "text-red-400"
            }`} data-testid="energia-soc-value">
              {state?.soc != null ? state.soc.toFixed(1) : "—"}
            </div>
            <div className="text-xl text-muted-foreground font-mono">%</div>
          </div>
          <Progress value={state?.soc ?? 0} className="h-2" />
          <div className="mt-3 flex items-center gap-2">
            {state?.charging && <Badge variant="outline" className="bg-emerald-500/15 border-emerald-500/40 text-emerald-300 gap-1"><ArrowUpCircle className="w-3 h-3" /> Cargando</Badge>}
            {state?.discharging && <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-300 gap-1"><ArrowDownCircle className="w-3 h-3" /> Descargando</Badge>}
            {state && !state.charging && !state.discharging && <Badge variant="outline" className="bg-slate-500/15 border-slate-500/40 text-slate-300">Sin movimiento</Badge>}
          </div>
        </div>

        {/* Load consumption card */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="energia-card-load">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Consumo</div>
              <div className="text-xs text-muted-foreground mt-0.5">Carga actual de la casa</div>
            </div>
            <Home className="w-8 h-8 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <div className="text-5xl font-bold tracking-tight text-sky-400" data-testid="energia-load-value">
              {state?.load_w != null ? Math.round(state.load_w) : "—"}
            </div>
            <div className="text-xl text-muted-foreground font-mono">W</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {state?.load_w != null && state.load_w >= 1000 && (
              <>Equivalente a <b className="text-foreground">{(state.load_w / 1000).toFixed(2)} kW</b></>
            )}
          </div>
        </div>

        {/* Charge/Discharge power card */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="energia-card-charge">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Batería (flujo)</div>
              <div className="text-xs text-muted-foreground mt-0.5">Carga / descarga en vivo</div>
            </div>
            {state?.charging ? <Sun className="w-8 h-8 text-emerald-400" />
              : state?.discharging ? <Zap className="w-8 h-8 text-amber-400" />
              : <Zap className="w-8 h-8 text-slate-400" />}
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <div className={`text-5xl font-bold tracking-tight ${
              state == null ? "text-slate-500"
              : state.charge_w > 5 ? "text-emerald-400"
              : state.charge_w < -5 ? "text-amber-400"
              : "text-slate-400"
            }`} data-testid="energia-charge-value">
              {state?.charge_w != null ? formatWatt(state.charge_w).replace(/[^0-9.\-]/g, "") : "—"}
            </div>
            <div className="text-xl text-muted-foreground font-mono">
              {state?.charge_w != null && Math.abs(state.charge_w) >= 1000 ? "kW" : "W"}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {state?.charging && <span className="text-emerald-300">↑ Cargando desde solar / red</span>}
            {state?.discharging && <span className="text-amber-300">↓ Descargando a la casa</span>}
            {state && !state.charging && !state.discharging && "Sin flujo neto"}
          </div>
        </div>
      </div>

      {state?.device_sn && (
        <div className="mt-4 text-[10px] text-muted-foreground font-mono text-right">
          Growatt SN: <code>{state.device_sn}</code> · Actualizado {new Date(state.updated_at).toLocaleString("es-MX")}
        </div>
      )}
    </div>
  );
}
