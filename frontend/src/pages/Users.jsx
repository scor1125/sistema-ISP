import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, ShieldCheck, UserCog, Clock, CalendarClock, KeyRound, Copy, Save, Zap,
  Sun, Coins, MapPin, Boxes, HandCoins, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const ROLES = [
  { value: "owner", label: "Dueño" },
  { value: "admin", label: "Administrador" },
  { value: "technician", label: "Técnico" },
  { value: "secretary", label: "Secretaria" },
  { value: "cobrador", label: "Cobrador" },
];

const MODULES = [
  { key: "clients",  label: "Clientes",   icon: UserCog, tint: "text-sky-400" },
  { key: "lugares",  label: "Lugares",    icon: MapPin,  tint: "text-emerald-400" },
  { key: "plans",    label: "Planes",     icon: Boxes,   tint: "text-purple-400" },
  { key: "promesas", label: "Promesas",   icon: Coins,   tint: "text-amber-400" },
  { key: "payments", label: "Pagos",      icon: HandCoins, tint: "text-rose-400" },
];

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];  // 0..6 Sun..Sat

const ROLE_DEFAULTS = {
  owner:      Object.fromEntries(MODULES.map(m => [m.key, { read: true,  write: true,  delete: true  }])),
  admin:      Object.fromEntries(MODULES.map(m => [m.key, { read: true,  write: true,  delete: true  }])),
  technician: Object.fromEntries(MODULES.map(m => [m.key, { read: true,  write: false, delete: false }])),
  secretary: {
    clients:  { read: true,  write: true,  delete: false },
    lugares:  { read: true,  write: false, delete: false },
    plans:    { read: true,  write: false, delete: false },
    promesas: { read: true,  write: true,  delete: false },
    payments: { read: true,  write: true,  delete: false },
  },
  cobrador: {
    clients:  { read: true,  write: false, delete: false },
    lugares:  { read: false, write: false, delete: false },
    plans:    { read: false, write: false, delete: false },
    promesas: { read: false, write: false, delete: false },
    payments: { read: false, write: true,  delete: false },
  },
};

const ROLE_TONE = {
  owner:      "bg-purple-500/15 border-purple-500/40 text-purple-300",
  admin:      "bg-rose-500/15 border-rose-500/40 text-rose-300",
  technician: "bg-sky-500/15 border-sky-500/40 text-sky-300",
  secretary:  "bg-amber-500/15 border-amber-500/40 text-amber-300",
  cobrador:   "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
};

function normalizePerms(perms, role) {
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.technician;
  const src = perms || defaults;
  const out = {};
  MODULES.forEach(m => {
    const s = src[m.key] || {};
    out[m.key] = {
      read: !!s.read, write: !!s.write, delete: !!s.delete,
    };
  });
  return out;
}

function formatTr(tr) {
  if (!tr) return null;
  const parts = [];
  if (tr.expires_at) {
    const exp = new Date(tr.expires_at);
    const ms = exp.getTime() - Date.now();
    if (ms > 0) {
      const h = Math.round(ms / 3.6e6);
      parts.push(h >= 24 ? `expira en ${Math.round(h / 24)}d` : `expira en ${h}h`);
    } else {
      parts.push("EXPIRADA");
    }
  }
  if (Array.isArray(tr.allowed_days) && tr.allowed_days.length && tr.allowed_days.length < 7) {
    parts.push(tr.allowed_days.map(i => DAYS[i]).join(","));
  }
  if (tr.allowed_hours_start != null && tr.allowed_hours_end != null) {
    parts.push(`${String(tr.allowed_hours_start).padStart(2, "0")}h–${String(tr.allowed_hours_end).padStart(2, "0")}h`);
  }
  return parts.length ? parts.join(" · ") : null;
}


function PermSwitchGrid({ perms, onChange, disabled }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-secondary/30 border-b border-border text-xs">
            <th className="text-left px-3 py-2 font-mono font-normal text-muted-foreground uppercase tracking-widest">Módulo</th>
            <th className="text-center px-3 py-2 font-mono font-normal text-muted-foreground uppercase tracking-widest">Leer</th>
            <th className="text-center px-3 py-2 font-mono font-normal text-muted-foreground uppercase tracking-widest">Escribir</th>
            <th className="text-center px-3 py-2 font-mono font-normal text-muted-foreground uppercase tracking-widest">Eliminar</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map(m => {
            const Icon = m.icon;
            return (
              <tr key={m.key} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Icon className={`w-4 h-4 ${m.tint}`} />
                    <span className="font-medium">{m.label}</span>
                  </div>
                </td>
                {["read", "write", "delete"].map(action => (
                  <td key={action} className="px-3 py-2 text-center">
                    <Switch
                      checked={!!perms[m.key]?.[action]}
                      disabled={disabled}
                      onCheckedChange={(v) => onChange(m.key, action, v)}
                      data-testid={`perm-${m.key}-${action}`}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function UserDetail({ user, onSaved, onDelete }) {
  const [perms, setPerms] = useState(() => normalizePerms(user.permissions, user.role));
  const [tr, setTr] = useState(user.time_restrictions || {});
  const [savingPerms, setSavingPerms] = useState(false);
  const [savingTr, setSavingTr] = useState(false);

  // Reload state when a different user is selected
  useEffect(() => {
    setPerms(normalizePerms(user.permissions, user.role));
    setTr(user.time_restrictions || {});
  }, [user.id, user.role, user.permissions, user.time_restrictions]);

  const setPerm = (m, a, v) => setPerms(p => ({ ...p, [m]: { ...p[m], [a]: v } }));

  const savePerms = async () => {
    setSavingPerms(true);
    try {
      const r = await api.patch(`/users/${user.id}/permissions`, { permissions: perms });
      toast.success("Permisos actualizados");
      onSaved(r.data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSavingPerms(false); }
  };

  const saveTr = async () => {
    setSavingTr(true);
    try {
      const payload = { time_restrictions: { ...tr } };
      // Clean empties
      if (payload.time_restrictions.ttl_hours === "" || payload.time_restrictions.ttl_hours == null) delete payload.time_restrictions.ttl_hours;
      if (!Array.isArray(payload.time_restrictions.allowed_days) || payload.time_restrictions.allowed_days.length === 0) delete payload.time_restrictions.allowed_days;
      if (payload.time_restrictions.allowed_hours_start === "" || payload.time_restrictions.allowed_hours_start == null) delete payload.time_restrictions.allowed_hours_start;
      if (payload.time_restrictions.allowed_hours_end === "" || payload.time_restrictions.allowed_hours_end == null) delete payload.time_restrictions.allowed_hours_end;
      const r = await api.patch(`/users/${user.id}/time-restrictions`, payload);
      toast.success("Restricciones actualizadas");
      onSaved(r.data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSavingTr(false); }
  };

  const clearTr = async () => {
    setTr({});
    try {
      await api.patch(`/users/${user.id}/time-restrictions`, { time_restrictions: {} });
      toast.success("Restricciones eliminadas");
      onSaved({ ...user, time_restrictions: null });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const toggleDay = (dow) => {
    const days = new Set(tr.allowed_days || []);
    if (days.has(dow)) days.delete(dow); else days.add(dow);
    setTr({ ...tr, allowed_days: Array.from(days).sort() });
  };

  const isCobrador = user.role === "cobrador";
  const isPrivileged = user.role === "owner" || user.role === "admin";

  return (
    <div className="border border-border rounded-md bg-card p-4 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 grid place-items-center text-white font-bold">
          {user.name?.[0]?.toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{user.name}</div>
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
        </div>
        <Badge variant="outline" className={ROLE_TONE[user.role] || ""}>{ROLES.find(r => r.value === user.role)?.label || user.role}</Badge>
      </div>

      {isCobrador && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-200">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <ShieldCheck className="w-4 h-4" /> Perfil Cobrador (restrictivo)
          </div>
          Solo puede <b>anexar pagos</b>. No ve datos sensibles del cliente (dirección, notas, plan)
          ni otros módulos, a menos que actives los interruptores de abajo manualmente.
        </div>
      )}

      {isPrivileged && (
        <div className="rounded-md border border-purple-500/40 bg-purple-500/5 p-3 text-xs text-purple-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Los roles Dueño y Administrador ignoran restricciones y permisos por diseño.
        </div>
      )}

      {/* Permissions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Permisos por módulo</div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPerms(normalizePerms(null, user.role))} data-testid="perm-reset">
              Restablecer por rol
            </Button>
            <Button size="sm" onClick={savePerms} disabled={savingPerms || isPrivileged} data-testid="perm-save">
              <Save className="w-3 h-3 mr-1" /> Guardar permisos
            </Button>
          </div>
        </div>
        <PermSwitchGrid perms={perms} onChange={setPerm} disabled={isPrivileged} />
      </div>

      {/* Time restrictions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Restricciones de acceso temporal</div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={clearTr} data-testid="tr-clear">
              Quitar
            </Button>
            <Button size="sm" onClick={saveTr} disabled={savingTr || isPrivileged} data-testid="tr-save">
              <Save className="w-3 h-3 mr-1" /> Guardar restricciones
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-md border border-border p-3 bg-secondary/20">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-1 mb-1">
              <Clock className="w-3 h-3" /> A) Vigencia (horas)
            </div>
            <Input
              type="number" min="0" step="1"
              value={tr.ttl_hours ?? ""}
              onChange={(e) => setTr({ ...tr, ttl_hours: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="Ej: 72"
              disabled={isPrivileged}
              data-testid="tr-ttl"
              className="h-9"
            />
            <div className="text-[10px] text-muted-foreground mt-1 font-mono">
              {tr.expires_at ? `Expira: ${new Date(tr.expires_at).toLocaleString("es-MX")}` : "Vacío = sin caducidad"}
            </div>
          </div>

          <div className="rounded-md border border-border p-3 bg-secondary/20">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">B) Días permitidos</div>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = (tr.allowed_days || []).includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(i)}
                    disabled={isPrivileged}
                    data-testid={`tr-day-${i}`}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                      on
                        ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-200"
                        : "bg-background border-input text-muted-foreground hover:bg-accent"
                    }`}
                  >{d}</button>
                );
              })}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 font-mono">
              {(tr.allowed_days || []).length === 0 ? "Todos los días" : `${(tr.allowed_days || []).length} de 7`}
            </div>
          </div>

          <div className="rounded-md border border-border p-3 bg-secondary/20">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">C) Horario permitido</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[9px] font-mono text-muted-foreground uppercase">Desde</Label>
                <Input
                  type="number" min="0" max="23"
                  value={tr.allowed_hours_start ?? ""}
                  onChange={(e) => setTr({ ...tr, allowed_hours_start: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="0-23" className="h-9" disabled={isPrivileged}
                  data-testid="tr-hstart"
                />
              </div>
              <div>
                <Label className="text-[9px] font-mono text-muted-foreground uppercase">Hasta</Label>
                <Input
                  type="number" min="0" max="24"
                  value={tr.allowed_hours_end ?? ""}
                  onChange={(e) => setTr({ ...tr, allowed_hours_end: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="0-24" className="h-9" disabled={isPrivileged}
                  data-testid="tr-hend"
                />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 font-mono">
              {tr.allowed_hours_start != null && tr.allowed_hours_end != null
                ? `${String(tr.allowed_hours_start).padStart(2, "0")}:00 – ${String(tr.allowed_hours_end).padStart(2, "0")}:00`
                : "Todo el día"}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-border flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground font-mono">
          Creado: {user.created_at ? new Date(user.created_at).toLocaleString("es-MX") : "—"}
        </div>
        <Button size="sm" variant="destructive" onClick={() => onDelete(user)} data-testid={`del-user-${user.id}`}>
          <Trash2 className="w-3 h-3 mr-1" /> Eliminar usuario
        </Button>
      </div>
    </div>
  );
}


export default function Users() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      setItems(data);
      if (!selectedId && data[0]) setSelectedId(data[0].id);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [selectedId]);
  useEffect(() => { load(); }, [load]);

  const selected = items.find((u) => u.id === selectedId);

  const fields = [
    { name: "name", label: "Nombre completo", required: true },
    { name: "email", label: "Email", required: true },
    { name: "phone", label: "Teléfono" },
    { name: "role", label: "Rol", type: "select", required: true,
      options: ROLES,
    },
    { name: "password", label: "Contraseña temporal", required: true, type: "password" },
    { name: "ttl_hours", label: "Vigencia en horas (opcional)", type: "number",
      placeholder: "Ej: 72 = 3 días demo",
    },
  ];

  const save = async (v) => {
    try {
      const payload = {
        name: v.name, email: v.email, phone: v.phone || "",
        role: v.role, password: v.password,
      };
      if (v.ttl_hours) {
        payload.time_restrictions = { ttl_hours: Number(v.ttl_hours) };
      }
      const { data } = await api.post("/users", payload);
      toast.success(`Usuario "${data.name}" creado como ${ROLES.find(r=>r.value===data.role)?.label}`);
      setDialogOpen(false);
      setSelectedId(data.id);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (u) => {
    if (!confirm(`¿Eliminar al usuario ${u.name}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Usuario eliminado");
      setSelectedId(items.find(x => x.id !== u.id)?.id || null);
      await load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Usuarios del sistema"
        subtitle="Control granular de permisos por módulo + restricciones de acceso temporal (cuentas demo, horarios, días de semana)."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="new-user-btn">
            <Plus className="w-4 h-4 mr-1" /> Nuevo usuario
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* User list */}
        <div className="lg:col-span-2 rounded-md border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="text-right">Restricciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8 text-sm">
                    Aún no hay usuarios. Crea el primero.
                  </TableCell>
                </TableRow>
              )}
              {items.map((u) => {
                const badge = formatTr(u.time_restrictions);
                const isActive = u.active !== false;
                return (
                  <TableRow
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    data-testid={`user-row-${u.id}`}
                    className={`cursor-pointer ${selectedId === u.id ? "bg-primary/10" : ""}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-400" : "bg-slate-500"}`} />
                        <div>
                          <div className="font-medium text-sm">{u.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{u.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${ROLE_TONE[u.role] || ""}`}>
                        {ROLES.find(r => r.value === u.role)?.label || u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {badge
                        ? <Badge variant="outline" className="font-mono text-[9px] gap-1 bg-amber-500/10 border-amber-500/40 text-amber-300"><Clock className="w-2.5 h-2.5" /> {badge}</Badge>
                        : <span className="text-[10px] text-muted-foreground/60">—</span>
                      }
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          {selected
            ? <UserDetail user={selected} onSaved={(u) => setItems(items.map(x => x.id === u.id ? u : x))} onDelete={del} />
            : <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
                <UserCog className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                Selecciona un usuario a la izquierda para configurar sus permisos y restricciones.
              </div>
          }
        </div>
      </div>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Nuevo usuario del sistema"
        fields={fields}
        initial={{ role: "technician" }}
        onSubmit={save}
        submitLabel="Crear usuario"
      />
    </div>
  );
}
