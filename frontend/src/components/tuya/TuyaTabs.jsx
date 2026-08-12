import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, Power, Home, Play, Clock, Calendar, Save,
  Sun, Moon, Snowflake, Zap, AirVent, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

const COLORS = ["#38bdf8", "#f59e0b", "#22c55e", "#a78bfa", "#f43f5e", "#14b8a6", "#eab308", "#6366f1"];
const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];  // 0=Sunday..6=Saturday
const DAY_FULL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const SCENE_PRESETS = {
  turn_off: { commands: [{ code: "switch", value: false }], icon: "moon", color: "#6366f1", label: "Apagar todo" },
  cool_22: {
    commands: [
      { code: "switch", value: true },
      { code: "mode", value: "cold" },
      { code: "temp_set", value: 22 },
    ], icon: "sun", color: "#f59e0b", label: "Enfriar a 22°C",
  },
  heat_24: {
    commands: [
      { code: "switch", value: true },
      { code: "mode", value: "hot" },
      { code: "temp_set", value: 24 },
    ], icon: "sun", color: "#ef4444", label: "Calentar a 24°C",
  },
};

const ICONS = { sun: Sun, moon: Moon, snowflake: Snowflake, zap: Zap };

// ============================================================================
// GROUPS TAB
// ============================================================================
export function GroupsTab({ devices, groups, onReload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState({});

  const emptyGroup = () => ({ name: "", color: COLORS[0], device_ids: [], notes: "" });
  const [form, setForm] = useState(emptyGroup());

  const startNew = () => { setEditing(null); setForm(emptyGroup()); setOpen(true); };
  const startEdit = (g) => {
    setEditing(g);
    setForm({
      name: g.name || "",
      color: g.color || COLORS[0],
      device_ids: g.device_ids || [],
      notes: g.notes || "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Ponle un nombre al grupo");
    try {
      if (editing) {
        await api.patch(`/tuya/groups/${editing.id}`, form);
        toast.success("Grupo actualizado");
      } else {
        await api.post("/tuya/groups", form);
        toast.success("Grupo creado");
      }
      setOpen(false);
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (g) => {
    if (!window.confirm(`¿Eliminar el grupo "${g.name}"? Los dispositivos NO se eliminan, solo dejan de estar agrupados.`)) return;
    try {
      await api.delete(`/tuya/groups/${g.id}`);
      toast.success("Grupo eliminado");
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const controlGroup = async (g, commands) => {
    if (busy[g.id]) return;
    setBusy((b) => ({ ...b, [g.id]: true }));
    try {
      const { data } = await api.post(`/tuya/groups/${g.id}/commands`, { commands });
      if (data.failed > 0) {
        toast.warning(`${data.ok}/${data.total} enviados · ${data.failed} fallaron`);
      } else {
        toast.success(`${data.ok}/${data.total} dispositivos actualizados`);
      }
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy((b) => ({ ...b, [g.id]: false })); }
  };

  const toggleDeviceInForm = (id) => {
    setForm((f) => ({
      ...f,
      device_ids: f.device_ids.includes(id)
        ? f.device_ids.filter((x) => x !== id)
        : [...f.device_ids, id],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground">
          Agrupa tus dispositivos por sala u oficina y contrólalos con un solo toggle.
        </div>
        <Button onClick={startNew} className="ml-auto" data-testid="tuya-new-group">
          <Plus className="w-4 h-4 mr-1" /> Nuevo grupo
        </Button>
      </div>

      {groups.length === 0 && (
        <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aún no creas grupos. Presiona <span className="font-medium">Nuevo grupo</span> para agrupar A/Cs por zona (Oficina / Casa / Taller...).
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {groups.map((g) => {
          const linkedDevs = devices.filter((d) => (g.device_ids || []).includes(d.id));
          const onlineCount = linkedDevs.filter((d) => d.online).length;
          return (
            <div
              key={g.id}
              className="rounded-md border p-4 space-y-3 bg-card"
              style={{ borderLeftWidth: 4, borderLeftColor: g.color || "#38bdf8" }}
              data-testid={`tuya-group-${g.id}`}
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-10 h-10 rounded-md grid place-items-center shrink-0"
                  style={{ backgroundColor: `${g.color}22`, color: g.color }}
                >
                  <Home className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" data-testid={`tuya-group-name-${g.id}`}>{g.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {linkedDevs.length} dispositivo{linkedDevs.length !== 1 ? "s" : ""} · {onlineCount} online
                  </div>
                </div>
              </div>

              {linkedDevs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {linkedDevs.slice(0, 4).map((d) => (
                    <Badge key={d.id} variant="outline" className="text-[10px]">
                      <AirVent className="w-3 h-3 mr-1" /> {d.name}
                    </Badge>
                  ))}
                  {linkedDevs.length > 4 && (
                    <Badge variant="outline" className="text-[10px]">+{linkedDevs.length - 4}</Badge>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Button
                  size="sm" variant="outline"
                  disabled={busy[g.id] || linkedDevs.length === 0}
                  onClick={() => controlGroup(g, [{ code: "switch", value: true }])}
                  data-testid={`tuya-group-on-${g.id}`}
                >
                  <Power className="w-3.5 h-3.5 mr-1 text-emerald-500" /> Encender
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={busy[g.id] || linkedDevs.length === 0}
                  onClick={() => controlGroup(g, [{ code: "switch", value: false }])}
                  data-testid={`tuya-group-off-${g.id}`}
                >
                  <Power className="w-3.5 h-3.5 mr-1 text-muted-foreground" /> Apagar
                </Button>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(g)}
                    data-testid={`tuya-group-edit-${g.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del(g)}
                    data-testid={`tuya-group-del-${g.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar grupo · ${editing.name}` : "Nuevo grupo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nombre del grupo</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Oficina, Casa, Taller…"
                data-testid="tuya-group-name-input"
              />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-md border-2 transition-transform ${
                      form.color === c ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Dispositivos ({form.device_ids.length} seleccionados)</Label>
              {devices.length === 0 ? (
                <div className="text-xs text-muted-foreground italic mt-1">
                  Aún no hay dispositivos sincronizados. Ve a la pestaña Dispositivos y presiona Refrescar.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto border border-border rounded-md p-1 mt-1">
                  {devices.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={form.device_ids.includes(d.id)}
                        onCheckedChange={() => toggleDeviceInForm(d.id)}
                      />
                      <span className="text-sm flex-1 truncate">{d.name}</span>
                      <Badge variant="outline" className={`text-[10px] ${d.online ? "text-emerald-500 border-emerald-500/40" : "text-muted-foreground"}`}>
                        {d.online ? "online" : "offline"}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} data-testid="tuya-group-save">
              <Save className="w-4 h-4 mr-1" /> {editing ? "Guardar cambios" : "Crear grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ============================================================================
// SCENES TAB
// ============================================================================
function commandsSummary(cmds = []) {
  if (!cmds.length) return "sin comandos";
  const parts = [];
  const map = Object.fromEntries(cmds.map((c) => [c.code, c.value]));
  if ("switch" in map) parts.push(map.switch ? "Encender" : "Apagar");
  if ("mode" in map) {
    const modes = { cold: "frío", hot: "calor", auto: "auto", wet: "deshu.", wind: "ventilar" };
    parts.push(modes[map.mode] || map.mode);
  }
  if ("temp_set" in map) parts.push(`${map.temp_set}°C`);
  if ("fan_speed_enum" in map) parts.push(`vent. ${map.fan_speed_enum}`);
  return parts.join(" · ") || cmds.map((c) => `${c.code}=${c.value}`).join(", ");
}

export function ScenesTab({ devices, groups, scenes, onReload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState({});

  const emptyScene = () => ({
    name: "",
    time: "08:00",
    days: [1, 2, 3, 4, 5],
    enabled: true,
    target: { kind: "all", group_id: null, device_ids: [] },
    action_preset: "cool_22",
    commands: SCENE_PRESETS.cool_22.commands,
  });
  const [form, setForm] = useState(emptyScene());

  const startNew = () => { setEditing(null); setForm(emptyScene()); setOpen(true); };
  const startEdit = (s) => {
    setEditing(s);
    // Try to detect the preset from stored commands
    const preset = Object.entries(SCENE_PRESETS).find(([, v]) =>
      JSON.stringify(v.commands) === JSON.stringify(s.commands)
    )?.[0] || "custom";
    setForm({
      name: s.name,
      time: s.time,
      days: s.days || [],
      enabled: s.enabled,
      target: {
        kind: s.target?.kind || "all",
        group_id: s.target?.group_id || null,
        device_ids: s.target?.device_ids || [],
      },
      action_preset: preset,
      commands: s.commands || [],
    });
    setOpen(true);
  };

  const applyPreset = (preset) => {
    if (preset === "custom") { setForm((f) => ({ ...f, action_preset: preset })); return; }
    setForm((f) => ({ ...f, action_preset: preset, commands: SCENE_PRESETS[preset].commands }));
  };

  const toggleDay = (d) => {
    setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Ponle un nombre a la escena");
    if (!form.time.match(/^\d{2}:\d{2}$/)) return toast.error("Hora inválida");
    if (form.days.length === 0) return toast.error("Elige al menos un día");
    const payload = {
      name: form.name.trim(),
      time: form.time,
      days: form.days,
      enabled: form.enabled,
      target: form.target,
      commands: form.commands,
    };
    try {
      if (editing) {
        await api.patch(`/tuya/scenes/${editing.id}`, payload);
        toast.success("Escena actualizada");
      } else {
        await api.post("/tuya/scenes", payload);
        toast.success("Escena creada");
      }
      setOpen(false);
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const toggleEnabled = async (s, enabled) => {
    try {
      await api.patch(`/tuya/scenes/${s.id}`, { enabled });
      toast.success(enabled ? "Escena activada" : "Escena pausada");
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const runNow = async (s) => {
    if (busy[s.id]) return;
    setBusy((b) => ({ ...b, [s.id]: true }));
    try {
      const { data } = await api.post(`/tuya/scenes/${s.id}/run`);
      if (data.error) toast.error(data.error);
      else if (data.failed > 0) toast.warning(`${data.ok}/${data.total} ok · ${data.failed} fallaron`);
      else toast.success(`Escena ejecutada · ${data.ok}/${data.total} dispositivos`);
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy((b) => ({ ...b, [s.id]: false })); }
  };

  const del = async (s) => {
    if (!window.confirm(`¿Eliminar la escena "${s.name}"?`)) return;
    try {
      await api.delete(`/tuya/scenes/${s.id}`);
      toast.success("Escena eliminada");
      onReload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const targetLabel = (t) => {
    if (!t) return "todos";
    if (t.kind === "all") return "Todos los dispositivos";
    if (t.kind === "group") {
      const g = groups.find((x) => x.id === t.group_id);
      return g ? `Grupo · ${g.name}` : "Grupo (no encontrado)";
    }
    if (t.kind === "devices") return `${(t.device_ids || []).length} dispositivos`;
    return t.kind;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground">
          Programa comandos por hora y día. Se ejecutan automáticamente cada 5 min vía cron.
        </div>
        <Button onClick={startNew} className="ml-auto" data-testid="tuya-new-scene">
          <Plus className="w-4 h-4 mr-1" /> Nueva escena
        </Button>
      </div>

      {scenes.length === 0 && (
        <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aún no hay escenas. Presiona <span className="font-medium">Nueva escena</span> para agendar comandos.
        </div>
      )}

      <div className="space-y-2">
        {scenes.map((s) => {
          const Icon = ICONS[s.icon] || Clock;
          return (
            <div
              key={s.id}
              className={`rounded-md border p-3 flex items-center gap-3 bg-card ${
                !s.enabled ? "opacity-60" : ""
              }`}
              data-testid={`tuya-scene-${s.id}`}
            >
              <div
                className="w-10 h-10 rounded-md grid place-items-center shrink-0"
                style={{ backgroundColor: `${s.color || "#f59e0b"}22`, color: s.color || "#f59e0b" }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" data-testid={`tuya-scene-name-${s.id}`}>{s.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    <Clock className="w-3 h-3 mr-1" /> {s.time}
                  </Badge>
                  <span className="flex gap-0.5">
                    {DAY_LABELS.map((d, i) => (
                      <span
                        key={i}
                        title={DAY_FULL[i]}
                        className={`w-4 h-4 grid place-items-center text-[9px] font-mono rounded-sm ${
                          (s.days || []).includes(i)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {d}
                      </span>
                    ))}
                  </span>
                  {s.last_run_status && (
                    <Badge variant="outline" className={`text-[10px] ${
                      s.last_run_status === "ok" ? "text-emerald-500 border-emerald-500/40"
                      : s.last_run_status === "error" ? "text-red-500 border-red-500/40"
                      : "text-amber-500 border-amber-500/40"
                    }`}>
                      {s.last_run_status === "ok" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                      {s.last_run_status === "error" && <AlertTriangle className="w-3 h-3 mr-1" />}
                      {s.last_run_status}
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {targetLabel(s.target)} · {commandsSummary(s.commands)}
                  {s.last_run_at && (
                    <span> · última: {new Date(s.last_run_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Switch
                  checked={!!s.enabled}
                  onCheckedChange={(v) => toggleEnabled(s, v)}
                  data-testid={`tuya-scene-toggle-${s.id}`}
                />
                <Button
                  size="sm" variant="outline"
                  disabled={busy[s.id]}
                  onClick={() => runNow(s)}
                  data-testid={`tuya-scene-run-${s.id}`}
                >
                  <Play className="w-3.5 h-3.5 mr-1" /> Ejecutar
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(s)}
                  data-testid={`tuya-scene-edit-${s.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del(s)}
                  data-testid={`tuya-scene-del-${s.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar escena · ${editing.name}` : "Nueva escena"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Enfriar oficina a las 8am"
                data-testid="tuya-scene-name-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Hora (24h)</Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  data-testid="tuya-scene-time-input"
                />
              </div>
              <div>
                <Label className="text-xs">Activa</Label>
                <div className="h-10 flex items-center gap-2">
                  <Switch
                    checked={!!form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {form.enabled ? "programada" : "pausada"}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Días de la semana</Label>
              <div className="flex gap-1 mt-1">
                {DAY_FULL.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-mono transition-colors ${
                      form.days.includes(i)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                    data-testid={`tuya-scene-day-${i}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Objetivo</Label>
              <Select
                value={form.target.kind}
                onValueChange={(v) => setForm({ ...form, target: { ...form.target, kind: v } })}
              >
                <SelectTrigger data-testid="tuya-scene-target-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los dispositivos</SelectItem>
                  <SelectItem value="group">Un grupo</SelectItem>
                  <SelectItem value="devices">Dispositivos específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.target.kind === "group" && (
              <div>
                <Label className="text-xs">Grupo</Label>
                <Select
                  value={form.target.group_id || ""}
                  onValueChange={(v) => setForm({ ...form, target: { ...form.target, group_id: v } })}
                >
                  <SelectTrigger data-testid="tuya-scene-target-group"><SelectValue placeholder="Elige un grupo" /></SelectTrigger>
                  <SelectContent>
                    {groups.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground italic">
                        No hay grupos aún. Créalos en la pestaña Grupos.
                      </div>
                    )}
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name} ({(g.device_ids || []).length})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.target.kind === "devices" && devices.length > 0 && (
              <div>
                <Label className="text-xs">Dispositivos ({form.target.device_ids?.length || 0} seleccionados)</Label>
                <div className="max-h-40 overflow-y-auto border border-border rounded-md p-1 mt-1">
                  {devices.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 px-2 py-1 hover:bg-accent rounded-sm cursor-pointer">
                      <Checkbox
                        checked={(form.target.device_ids || []).includes(d.id)}
                        onCheckedChange={() => {
                          const cur = form.target.device_ids || [];
                          const next = cur.includes(d.id) ? cur.filter((x) => x !== d.id) : [...cur, d.id];
                          setForm({ ...form, target: { ...form.target, device_ids: next } });
                        }}
                      />
                      <span className="text-sm">{d.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Acción</Label>
              <Select value={form.action_preset} onValueChange={applyPreset}>
                <SelectTrigger data-testid="tuya-scene-preset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SCENE_PRESETS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Personalizada (mantener actual)</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                → {commandsSummary(form.commands)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} data-testid="tuya-scene-save">
              <Save className="w-4 h-4 mr-1" /> {editing ? "Guardar cambios" : "Crear escena"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
