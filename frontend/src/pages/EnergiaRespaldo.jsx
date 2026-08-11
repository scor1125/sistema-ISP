import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BatteryFull, BatteryLow, BatteryMedium, Zap, Sun, Home,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, AlertTriangle, Clock,
  Plus, Pencil, Trash2, Settings2,
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
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export default function EnergiaRespaldo() {
  const [plants, setPlants] = useState([]);
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadPlants = useCallback(async () => {
    try {
      const { data } = await api.get("/energia/plants");
      setPlants(data);
      if (!active && data[0]) setActive(data[0].id);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [active]);

  const loadEstado = useCallback(async (plantId, force = false) => {
    if (!plantId) return;
    setLoading(true); setError(null);
    try {
      const { data } = await api.get("/energia/estado", { params: { plant: plantId, force: force || undefined } });
      setData(data);
    } catch (e) { setError(formatApiError(e)); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPlants(); }, [loadPlants]);
  useEffect(() => { if (active) loadEstado(active); }, [active, loadEstado]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => loadEstado(active), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [active, loadEstado]);

  const state = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      charging: data.charge_w > 5,
      discharging: data.charge_w < -5,
    };
  }, [data]);

  const fields = [
    { name: "name", label: "Nombre de la planta", required: true, full: true, placeholder: "Casa, Oficina…" },
    { name: "plant_id", label: "Plant ID (Growatt)", required: true, placeholder: "10925502" },
    { name: "device_sn", label: "Device SN (opcional)", placeholder: "Se descubre automáticamente si vacío" },
    { name: "color", label: "Color", type: "color" },
    { name: "order", label: "Orden", type: "number", placeholder: "0" },
  ];

  const savePlant = async (v) => {
    try {
      const payload = { ...v };
      if (payload.order === "" || payload.order == null) payload.order = 0;
      if (editing) {
        await api.patch(`/energia/plants/${editing.id}`, payload);
        toast.success("Planta actualizada");
      } else {
        const { data: created } = await api.post("/energia/plants", payload);
        toast.success("Planta creada");
        setActive(created.id);
      }
      setEditing(null); setManageOpen(false);
      loadPlants();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deletePlant = async (p) => {
    if (plants.length <= 1) { toast.error("Debes tener al menos una planta"); return; }
    if (!confirm(`¿Eliminar la planta "${p.name}"?`)) return;
    try {
      await api.delete(`/energia/plants/${p.id}`);
      toast.success("Planta eliminada");
      if (active === p.id) setActive(plants.find((x) => x.id !== p.id)?.id || null);
      loadPlants();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const activePlant = plants.find((p) => p.id === active);

  return (
    <div>
      <PageHeader
        title="Energía de respaldo"
        subtitle="Estado en tiempo real de tus plantas Growatt · ShinePhone (auto-refresh cada 5 min)"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {state?.updated_at && (
              <Badge variant="outline" className="font-mono text-[10px] gap-1">
                <Clock className="w-3 h-3" /> {timeAgo(state.updated_at)}
                {state.cached && <span className="text-slate-400 ml-1">(caché)</span>}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => { setEditing(null); setManageOpen(true); }} data-testid="energia-new-plant">
              <Plus className="w-4 h-4 mr-1" /> Nueva planta
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadEstado(active, true)} disabled={loading || !active} data-testid="energia-refresh">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </div>
        }
      />

      {/* Tabs per plant */}
      {plants.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Tabs value={active || ""} onValueChange={setActive}>
            <TabsList data-testid="energia-plant-tabs">
              {plants.map((p) => (
                <TabsTrigger key={p.id} value={p.id} data-testid={`energia-tab-${p.id}`} className="gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || "#22c55e" }} />
                  {p.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {activePlant && (
            <div className="flex items-center gap-1 ml-2">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(activePlant); setManageOpen(true); }} data-testid={`energia-edit-plant-${activePlant.id}`}>
                <Pencil className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deletePlant(activePlant)} data-testid={`energia-delete-plant-${activePlant.id}`}>
                <Trash2 className="w-3 h-3 text-red-400" />
              </Button>
            </div>
          )}
        </div>
      )}

      {plants.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground mb-4">
          <Settings2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
          Aún no hay plantas Growatt configuradas. Crea la primera con el botón <b>Nueva planta</b>.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 mb-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-red-300">No se pudo leer Growatt</div>
            <div className="text-xs text-red-100/80 font-mono mt-1">{error}</div>
            <div className="text-[11px] text-slate-400 mt-2">
              Verifica <code>GROWATT_API_KEY</code> en <code>backend/.env</code> y que el <b>Plant ID</b> de "{activePlant?.name}" sea correcto.
            </div>
          </div>
        </div>
      )}

      {/* Live cards */}
      {activePlant && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <span style={{ color: activePlant.color }}>●</span> {activePlant.name} · Growatt Plant <code>{activePlant.plant_id}</code> · SN <code>{state.device_sn}</code> · Actualizado {new Date(state.updated_at).toLocaleString("es-MX")}
            </div>
          )}
        </>
      )}

      <FormDialog
        open={manageOpen}
        onOpenChange={(v) => { setManageOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar planta" : "Nueva planta Growatt"}
        fields={fields}
        initial={editing || { color: "#22c55e", order: plants.length }}
        onSubmit={savePlant}
        submitLabel={editing ? "Guardar cambios" : "Crear planta"}
      />
    </div>
  );
}
