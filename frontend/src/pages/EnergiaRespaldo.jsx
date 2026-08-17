import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BatteryFull, BatteryLow, BatteryMedium, Zap, Sun, Home,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, AlertTriangle, Clock,
  Plus, Pencil, Trash2, Settings2,
} from "lucide-react";
import { toast } from "sonner";

function BatteryIcon({ pct }) {
  if (pct == null) return <BatteryLow className="w-7 h-7 text-slate-400" />;
  if (pct >= 66) return <BatteryFull className="w-7 h-7 text-emerald-400" />;
  if (pct >= 33) return <BatteryMedium className="w-7 h-7 text-amber-400" />;
  return <BatteryLow className="w-7 h-7 text-red-400" />;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

/**
 * Card component that renders a single plant's live state (SOC / consumo /
 * flujo de batería). Handles its own loading + error state so one broken
 * plant doesn't hide the others.
 */
function PlantCard({ plant, state, error, loading, onRefresh, onEdit, onDelete }) {
  const charging = state?.charge_w > 5;
  const discharging = state?.charge_w < -5;

  return (
    <section
      className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden"
      data-testid={`energia-plant-section-${plant.id}`}
    >
      {/* Plant header */}
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border/70 bg-gradient-to-r from-transparent"
        style={{ borderLeft: `4px solid ${plant.color || "#22c55e"}` }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: plant.color || "#22c55e" }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-heading truncate" data-testid={`energia-plant-name-${plant.id}`}>
            {plant.name}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono truncate">
            Plant <code>{plant.plant_id}</code>
            {state?.device_sn && <> · SN <code>{state.device_sn}</code></>}
            {state?.updated_at && <> · <Clock className="w-2.5 h-2.5 inline mb-0.5" /> {timeAgo(state.updated_at)}
              {state.cached && <span className="text-slate-500 ml-1">(caché)</span>}</>}
          </div>
        </div>
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          disabled={loading}
          onClick={onRefresh}
          data-testid={`energia-refresh-${plant.id}`}
          title="Actualizar ahora"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          onClick={onEdit}
          data-testid={`energia-edit-plant-${plant.id}`}
          title="Editar planta"
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          onClick={onDelete}
          data-testid={`energia-delete-plant-${plant.id}`}
          title="Eliminar planta"
        >
          <Trash2 className="w-3 h-3 text-red-400" />
        </Button>
      </header>

      {/* Body */}
      <div className="p-4">
        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-300">No se pudo leer Growatt</div>
              <div className="text-[11px] text-red-100/80 font-mono mt-0.5 break-words">{error}</div>
              <div className="text-[10px] text-slate-400 mt-1.5">
                Revisa <code>GROWATT_API_KEY</code> en <code>backend/.env</code> y que el <b>Plant ID</b> sea correcto.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* SOC */}
            <div className="rounded-lg border border-border/60 bg-card p-3" data-testid={`energia-card-soc-${plant.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Batería</div>
                <BatteryIcon pct={state?.soc} />
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <div
                  className={`text-3xl font-bold tracking-tight ${
                    state?.soc == null ? "text-slate-500"
                    : state.soc >= 66 ? "text-emerald-400"
                    : state.soc >= 33 ? "text-amber-400"
                    : "text-red-400"
                  }`}
                  data-testid={`energia-soc-${plant.id}`}
                >
                  {state?.soc != null ? state.soc.toFixed(1) : "—"}
                </div>
                <div className="text-sm text-muted-foreground font-mono">%</div>
              </div>
              <Progress value={state?.soc ?? 0} className="h-1.5" />
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {charging && <Badge variant="outline" className="bg-emerald-500/15 border-emerald-500/40 text-emerald-300 gap-1 text-[10px] py-0"><ArrowUpCircle className="w-2.5 h-2.5" /> Cargando</Badge>}
                {discharging && <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-300 gap-1 text-[10px] py-0"><ArrowDownCircle className="w-2.5 h-2.5" /> Descarga</Badge>}
                {state && !charging && !discharging && <Badge variant="outline" className="text-[10px] py-0 text-slate-400">Sin flujo</Badge>}
              </div>
            </div>

            {/* Consumo */}
            <div className="rounded-lg border border-border/60 bg-card p-3" data-testid={`energia-card-load-${plant.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Consumo casa</div>
                <Home className="w-7 h-7 text-sky-400" />
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <div className="text-3xl font-bold tracking-tight text-sky-400" data-testid={`energia-load-${plant.id}`}>
                  {state?.load_w != null ? Math.round(state.load_w) : "—"}
                </div>
                <div className="text-sm text-muted-foreground font-mono">W</div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {state?.load_w != null && state.load_w >= 1000 && (
                  <>≈ <b className="text-foreground">{(state.load_w / 1000).toFixed(2)} kW</b></>
                )}
              </div>
            </div>

            {/* Flujo batería */}
            <div className="rounded-lg border border-border/60 bg-card p-3" data-testid={`energia-card-charge-${plant.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Flujo batería</div>
                {charging ? <Sun className="w-7 h-7 text-emerald-400" />
                  : discharging ? <Zap className="w-7 h-7 text-amber-400" />
                  : <Zap className="w-7 h-7 text-slate-400" />}
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <div
                  className={`text-3xl font-bold tracking-tight ${
                    state?.charge_w == null ? "text-slate-500"
                    : charging ? "text-emerald-400"
                    : discharging ? "text-amber-400"
                    : "text-slate-400"
                  }`}
                  data-testid={`energia-charge-${plant.id}`}
                >
                  {state?.charge_w != null ? Math.abs(Math.round(state.charge_w)) : "—"}
                </div>
                <div className="text-sm text-muted-foreground font-mono">
                  {state?.charge_w != null && Math.abs(state.charge_w) >= 1000 ? "kW" : "W"}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {charging && <span className="text-emerald-300">↑ Cargando desde solar / red</span>}
                {discharging && <span className="text-amber-300">↓ Descargando a la casa</span>}
                {state && !charging && !discharging && "Sin flujo neto"}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function EnergiaRespaldo() {
  const [plants, setPlants] = useState([]);
  const [statesById, setStatesById] = useState({}); // { plantId: state }
  const [errorsById, setErrorsById] = useState({}); // { plantId: errorMsg }
  const [loadingById, setLoadingById] = useState({}); // { plantId: bool }
  const [manageOpen, setManageOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadPlants = useCallback(async () => {
    try {
      const { data } = await api.get("/energia/plants");
      setPlants(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  const loadEstadoOne = useCallback(async (plantId, force = false) => {
    if (!plantId) return;
    setLoadingById((m) => ({ ...m, [plantId]: true }));
    try {
      const { data } = await api.get("/energia/estado", {
        params: { plant: plantId, force: force || undefined },
      });
      setStatesById((m) => ({ ...m, [plantId]: data }));
      setErrorsById((m) => { const n = { ...m }; delete n[plantId]; return n; });
    } catch (e) {
      const msg = formatApiError(e);
      setErrorsById((m) => ({ ...m, [plantId]: msg }));
      setStatesById((m) => { const n = { ...m }; delete n[plantId]; return n; });
    } finally {
      setLoadingById((m) => ({ ...m, [plantId]: false }));
    }
  }, []);

  // Load initial plant list once.
  useEffect(() => { loadPlants(); }, [loadPlants]);

  // Fan-out: fetch estado for every plant in parallel whenever the plant list
  // changes. Each one has its own loading/error state so a bad plant doesn't
  // block the healthy ones.
  useEffect(() => {
    if (plants.length === 0) return;
    plants.forEach((p) => { loadEstadoOne(p.id); });
  }, [plants, loadEstadoOne]);

  // Auto-refresh every 5 minutes for all plants at once.
  useEffect(() => {
    if (plants.length === 0) return;
    const t = setInterval(() => {
      plants.forEach((p) => { loadEstadoOne(p.id); });
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [plants, loadEstadoOne]);

  const refreshAll = useCallback(() => {
    if (plants.length === 0) return;
    plants.forEach((p) => { loadEstadoOne(p.id, true); });
    toast.success(`Actualizando ${plants.length} planta${plants.length !== 1 ? "s" : ""}…`);
  }, [plants, loadEstadoOne]);

  const anyLoading = useMemo(
    () => Object.values(loadingById).some(Boolean),
    [loadingById],
  );

  // Roll-up KPIs across all plants that returned a healthy state.
  const rollup = useMemo(() => {
    const readings = Object.values(statesById);
    if (readings.length === 0) return null;
    const totalLoad = readings.reduce((sum, s) => sum + (s.load_w ?? 0), 0);
    const totalCharge = readings.reduce((sum, s) => sum + (s.charge_w ?? 0), 0);
    const avgSoc = readings.reduce((sum, s) => sum + (s.soc ?? 0), 0) / readings.length;
    return {
      count: readings.length,
      totalLoad,
      totalCharge,
      avgSoc,
    };
  }, [statesById]);

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
        await api.post("/energia/plants", payload);
        toast.success("Planta creada");
      }
      setEditing(null); setManageOpen(false);
      loadPlants();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deletePlant = async (p) => {
    if (!window.confirm(`¿Eliminar la planta "${p.name}"?`)) return;
    try {
      await api.delete(`/energia/plants/${p.id}`);
      toast.success("Planta eliminada");
      setStatesById((m) => { const n = { ...m }; delete n[p.id]; return n; });
      setErrorsById((m) => { const n = { ...m }; delete n[p.id]; return n; });
      loadPlants();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Energía de respaldo"
        subtitle={`Todas tus plantas Growatt en una sola vista · auto-refresh cada 5 min${plants.length ? ` · ${plants.length} planta${plants.length !== 1 ? "s" : ""}` : ""}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm" variant="outline"
              onClick={() => { setEditing(null); setManageOpen(true); }}
              data-testid="energia-new-plant"
            >
              <Plus className="w-4 h-4 mr-1" /> Nueva planta
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={refreshAll}
              disabled={anyLoading || plants.length === 0}
              data-testid="energia-refresh-all"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${anyLoading ? "animate-spin" : ""}`} />
              Actualizar todas
            </Button>
          </div>
        }
      />

      {/* Roll-up KPIs */}
      {rollup && rollup.count > 1 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">SOC promedio</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1" data-testid="energia-rollup-soc">
              {rollup.avgSoc.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Consumo total</div>
            <div className="text-2xl font-bold text-sky-400 mt-1" data-testid="energia-rollup-load">
              {rollup.totalLoad >= 1000
                ? `${(rollup.totalLoad / 1000).toFixed(2)} kW`
                : `${Math.round(rollup.totalLoad)} W`}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Flujo total</div>
            <div className={`text-2xl font-bold mt-1 ${
              rollup.totalCharge > 5 ? "text-emerald-400"
              : rollup.totalCharge < -5 ? "text-amber-400"
              : "text-slate-400"
            }`} data-testid="energia-rollup-charge">
              {Math.abs(rollup.totalCharge) >= 1000
                ? `${Math.abs(rollup.totalCharge / 1000).toFixed(2)} kW`
                : `${Math.abs(Math.round(rollup.totalCharge))} W`}
              <span className="text-xs text-muted-foreground font-mono ml-1">
                {rollup.totalCharge > 5 ? "↑" : rollup.totalCharge < -5 ? "↓" : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      {plants.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Settings2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
          Aún no hay plantas Growatt configuradas. Crea la primera con el botón <b>Nueva planta</b>.
        </div>
      ) : (
        <div className="space-y-4">
          {plants.map((p) => (
            <PlantCard
              key={p.id}
              plant={p}
              state={statesById[p.id]}
              error={errorsById[p.id]}
              loading={!!loadingById[p.id]}
              onRefresh={() => loadEstadoOne(p.id, true)}
              onEdit={() => { setEditing(p); setManageOpen(true); }}
              onDelete={() => deletePlant(p)}
            />
          ))}
        </div>
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
