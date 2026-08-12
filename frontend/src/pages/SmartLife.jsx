import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AirVent, RefreshCw, Wifi, WifiOff, Snowflake, Sun, Wind, Zap,
  Settings2, Pencil, Trash2, Plus, Minus, Power, KeyRound, CheckCircle2,
  AlertTriangle, Save, ShieldCheck, ShieldAlert, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const REGION_LABELS = {
  us: "🇲🇽 América (US) — openapi.tuyaus.com",
  eu: "🇪🇺 Europa — openapi.tuyaeu.com",
  cn: "🇨🇳 China — openapi.tuyacn.com",
  in: "🇮🇳 India — openapi.tuyain.com",
  we: "US West — openapi-weaz.tuyaus.com",
  ue: "US East — openapi-ueaz.tuyaus.com",
};

const MODE_LABELS = {
  cold: { label: "Frío", icon: Snowflake, color: "text-sky-400" },
  hot: { label: "Calor", icon: Sun, color: "text-amber-400" },
  wet: { label: "Deshu.", icon: Wind, color: "text-cyan-400" },
  wind: { label: "Ventilar", icon: Wind, color: "text-slate-400" },
  auto: { label: "Auto", icon: Zap, color: "text-emerald-400" },
};

const FAN_LABELS = {
  low: "Baja", mid: "Media", high: "Alta", auto: "Auto",
  "1": "1", "2": "2", "3": "3", "4": "4",
};

// Try common Tuya DP codes for A/C devices
const readState = (status = {}) => ({
  on: status.switch ?? status.switch_1 ?? status["switch_led"] ?? false,
  temp: status.temp_set ?? status.temp_current ?? status.temp ?? null,
  ambient: status.temp_current ?? null,
  mode: status.mode ?? null,
  fan: status.fan_speed_enum ?? status.fan_speed ?? null,
});

function ConfigCard({ config, onSaved }) {
  const [f, setF] = useState({
    access_id: config?.access_id || "",
    access_secret: "",  // never prefill
    region: config?.region || "us",
    project_code: config?.project_code || "",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...f };
      if (!payload.access_secret) delete payload.access_secret;  // preserve stored
      await api.patch("/tuya/config", payload);
      toast.success("Credenciales guardadas");
      setF((p) => ({ ...p, access_secret: "" }));
      await onSaved?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post("/tuya/test-auth");
      setTestResult({ ok: true, message: `Token OK · región ${data.region.toUpperCase()}` });
      toast.success("Conexión con Tuya verificada");
    } catch (e) {
      const msg = formatApiError(e);
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally { setTesting(false); }
  };

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4" data-testid="tuya-config-card">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Configuración Tuya IoT Cloud</h3>
        {config?.configured ? (
          <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40 ml-auto">
            <ShieldCheck className="w-3 h-3 mr-1" /> configurado
          </Badge>
        ) : (
          <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40 ml-auto">
            <ShieldAlert className="w-3 h-3 mr-1" /> falta configurar
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Access ID (Client ID)</Label>
          <Input
            value={f.access_id}
            onChange={(e) => setF({ ...f, access_id: e.target.value })}
            placeholder="tuya_access_id_xxxxxxx"
            data-testid="tuya-access-id"
          />
        </div>
        <div>
          <Label className="text-xs">
            Access Secret
            {config?.has_secret && (
              <span className="text-muted-foreground ml-2 text-[10px]">
                (guardado: <span className="font-mono">{config.access_secret_masked}</span>)
              </span>
            )}
          </Label>
          <Input
            type="password"
            value={f.access_secret}
            onChange={(e) => setF({ ...f, access_secret: e.target.value })}
            placeholder={config?.has_secret ? "Deja vacío para conservar el actual" : "tuya_access_secret_xxxxxx"}
            data-testid="tuya-access-secret"
          />
        </div>
        <div>
          <Label className="text-xs">Región / Data Center</Label>
          <Select value={f.region} onValueChange={(v) => setF({ ...f, region: v })}>
            <SelectTrigger data-testid="tuya-region"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(REGION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Project Code (opcional)</Label>
          <Input
            value={f.project_code}
            onChange={(e) => setF({ ...f, project_code: e.target.value })}
            placeholder="p1234567890abc"
            data-testid="tuya-project-code"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving} data-testid="tuya-save-config">
          <Save className="w-4 h-4 mr-1" />
          {saving ? "Guardando…" : "Guardar credenciales"}
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || !config?.configured}
          data-testid="tuya-test-auth"
        >
          <KeyRound className={`w-4 h-4 mr-1 ${testing ? "animate-spin" : ""}`} />
          {testing ? "Probando…" : "Probar conexión"}
        </Button>
        <a
          href="https://iot.tuya.com/cloud/"
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
        >
          Tuya IoT Platform <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {testResult && (
        <div
          className={`rounded-md border p-2 text-sm ${
            testResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}
          data-testid="tuya-test-result"
        >
          {testResult.ok ? <CheckCircle2 className="w-4 h-4 inline mr-1" /> : <AlertTriangle className="w-4 h-4 inline mr-1" />}
          {testResult.message}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device, onCommand, onRename, onDelete }) {
  const state = useMemo(() => readState(device.status || {}), [device.status]);
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(device.name);
  const [tempPreview, setTempPreview] = useState(state.temp || 24);

  useEffect(() => { setTempPreview(state.temp ?? 24); }, [state.temp]);

  const wrap = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    finally { setBusy(false); }
  };

  const modeInfo = state.mode && MODE_LABELS[state.mode];
  const ModeIcon = modeInfo?.icon || Zap;
  const isAC = device.category === "kt" || /aire|air|ac|split/i.test(device.product_name || "");

  return (
    <div
      className={`rounded-md border p-4 space-y-3 transition-colors ${
        device.online
          ? "border-border bg-card"
          : "border-red-500/20 bg-red-500/5 opacity-70"
      }`}
      data-testid={`tuya-device-${device.id}`}
    >
      <div className="flex items-start gap-2">
        <div className={`w-10 h-10 rounded-md grid place-items-center shrink-0 ${
          device.online ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          {isAC ? <AirVent className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate" data-testid={`tuya-device-name-${device.id}`}>{device.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {device.product_name || device.category || "dispositivo"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {device.online ? (
            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40 text-[10px]">
              <Wifi className="w-3 h-3 mr-1" /> online
            </Badge>
          ) : (
            <Badge className="bg-red-500/20 text-red-500 border-red-500/40 text-[10px]">
              <WifiOff className="w-3 h-3 mr-1" /> offline
            </Badge>
          )}
        </div>
      </div>

      {/* Main state */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Estado</div>
          <div className={`text-lg font-semibold ${state.on ? "text-emerald-500" : "text-muted-foreground"}`}>
            {state.on ? "ON" : "OFF"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Temp.</div>
          <div className="text-lg font-semibold" data-testid={`tuya-temp-${device.id}`}>
            {state.temp != null ? `${state.temp}°` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Modo</div>
          <div className={`text-lg font-semibold ${modeInfo?.color || "text-muted-foreground"}`}>
            {modeInfo ? (
              <span className="flex items-center gap-1">
                <ModeIcon className="w-4 h-4" /> {modeInfo.label}
              </span>
            ) : "—"}
          </div>
        </div>
      </div>

      {/* ON/OFF */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Power className={`w-4 h-4 ${state.on ? "text-emerald-500" : "text-muted-foreground"}`} />
        <span className="text-xs">Encendido</span>
        <Switch
          checked={!!state.on}
          disabled={!device.online || busy}
          onCheckedChange={(v) => wrap(() => onCommand(device.id, [{ code: "switch", value: !!v }]))}
          className="ml-auto"
          data-testid={`tuya-power-${device.id}`}
        />
      </div>

      {/* Temperature */}
      {isAC && state.on && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Temperatura</span>
            <span className="ml-auto font-mono">{tempPreview}°C</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon" variant="outline" className="h-8 w-8" disabled={busy || !device.online}
              onClick={() => wrap(() => {
                const next = Math.max(16, (state.temp ?? 24) - 1);
                setTempPreview(next);
                return onCommand(device.id, [{ code: "temp_set", value: next }]);
              })}
              data-testid={`tuya-temp-down-${device.id}`}
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Slider
              min={16} max={30} step={1}
              value={[tempPreview]}
              disabled={busy || !device.online}
              onValueChange={(v) => setTempPreview(v[0])}
              onValueCommit={(v) => wrap(() => onCommand(device.id, [{ code: "temp_set", value: v[0] }]))}
              className="flex-1"
            />
            <Button
              size="icon" variant="outline" className="h-8 w-8" disabled={busy || !device.online}
              onClick={() => wrap(() => {
                const next = Math.min(30, (state.temp ?? 24) + 1);
                setTempPreview(next);
                return onCommand(device.id, [{ code: "temp_set", value: next }]);
              })}
              data-testid={`tuya-temp-up-${device.id}`}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Mode + Fan */}
      {isAC && state.on && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Modo</Label>
            <Select
              value={state.mode || ""}
              disabled={busy || !device.online}
              onValueChange={(v) => wrap(() => onCommand(device.id, [{ code: "mode", value: v }]))}
            >
              <SelectTrigger data-testid={`tuya-mode-${device.id}`}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Ventilador</Label>
            <Select
              value={state.fan || ""}
              disabled={busy || !device.online}
              onValueChange={(v) => wrap(() => onCommand(device.id, [{ code: "fan_speed_enum", value: v }]))}
            >
              <SelectTrigger data-testid={`tuya-fan-${device.id}`}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {Object.entries(FAN_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button
          size="sm" variant="ghost"
          onClick={() => { setNewName(device.name); setRenameOpen(true); }}
          data-testid={`tuya-rename-btn-${device.id}`}
        >
          <Pencil className="w-3.5 h-3.5 mr-1" /> Renombrar
        </Button>
        <Button
          size="sm" variant="ghost"
          className="text-destructive ml-auto"
          onClick={() => {
            if (window.confirm(`¿Eliminar "${device.name}" del proyecto Tuya? El dispositivo dejará de aparecer aquí (podés volver a agregarlo desde la app Smart Life).`)) {
              onDelete(device.id);
            }
          }}
          data-testid={`tuya-delete-${device.id}`}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
        </Button>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Renombrar dispositivo</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Nuevo nombre</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              data-testid={`tuya-rename-input-${device.id}`}
            />
            <div className="text-[11px] text-muted-foreground">
              El nombre se actualiza en la nube Tuya. La app Smart Life del móvil lo verá al sincronizar.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancelar</Button>
            <Button
              disabled={!newName.trim() || newName.trim() === device.name}
              onClick={async () => {
                await onRename(device.id, newName.trim());
                setRenameOpen(false);
              }}
              data-testid={`tuya-rename-save-${device.id}`}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SmartLife() {
  const [config, setConfig] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await api.get("/tuya/config");
      setConfig(data);
      if (!data.configured) setShowConfig(true);
      return data;
    } catch (e) {
      toast.error(formatApiError(e));
      return null;
    }
  }, []);

  const loadDevices = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get("/tuya/devices");
      setDevices(data);
    } catch (e) {
      setError(formatApiError(e));
      setDevices([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const c = await loadConfig();
      if (c?.configured) await loadDevices();
    })();
  }, [loadConfig, loadDevices]);

  const sendCommand = async (deviceId, commands) => {
    try {
      await api.post(`/tuya/devices/${deviceId}/commands`, { commands });
      toast.success("Comando enviado");
      // reload after a beat so status refreshes
      setTimeout(loadDevices, 700);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const renameDevice = async (deviceId, name) => {
    try {
      await api.patch(`/tuya/devices/${deviceId}`, { name });
      toast.success("Nombre actualizado");
      await loadDevices();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteDevice = async (deviceId) => {
    try {
      await api.delete(`/tuya/devices/${deviceId}`);
      toast.success("Dispositivo eliminado");
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const kpis = useMemo(() => ({
    total: devices.length,
    online: devices.filter((d) => d.online).length,
    on: devices.filter((d) => d.online && readState(d.status).on).length,
  }), [devices]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Smart Life · Tuya IoT"
        subtitle="Controla tus aires acondicionados y dispositivos IoT vinculados a tu proyecto Tuya Cloud."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfig((v) => !v)}
              data-testid="tuya-toggle-config"
            >
              <Settings2 className="w-4 h-4 mr-1" /> {showConfig ? "Ocultar config" : "Config"}
            </Button>
            <Button
              onClick={loadDevices}
              disabled={loading || !config?.configured}
              data-testid="tuya-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Cargando…" : "Refrescar"}
            </Button>
          </div>
        }
      />

      {(showConfig || !config?.configured) && (
        <ConfigCard config={config} onSaved={loadConfig} />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Total</div>
          <div className="text-2xl font-semibold" data-testid="tuya-kpi-total">{kpis.total}</div>
        </div>
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-mono">
            <Wifi className="w-3 h-3 inline mr-1" /> Online
          </div>
          <div className="text-2xl font-semibold" data-testid="tuya-kpi-online">{kpis.online}</div>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-primary font-mono">
            <Power className="w-3 h-3 inline mr-1" /> Encendidos
          </div>
          <div className="text-2xl font-semibold" data-testid="tuya-kpi-on">{kpis.on}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500" data-testid="tuya-error">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}

      {/* Devices grid */}
      {devices.length === 0 && !loading && config?.configured && !error && (
        <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          No hay dispositivos en tu proyecto Tuya todavía. Agrega A/Cs desde la app Smart Life y luego presiona <span className="font-medium">Refrescar</span>.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onCommand={sendCommand}
            onRename={renameDevice}
            onDelete={deleteDevice}
          />
        ))}
      </div>
    </div>
  );
}
