import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Router as RouterIcon, Pencil, Trash2, Radio, Cpu, Copy,
  CheckCircle2, XCircle, Terminal, ChevronDown, ChevronUp, KeyRound,
} from "lucide-react";
import { toast } from "sonner";

const SSTP_SETUP_SCRIPT = `# ============================================================
# EnlaceHR ISP · Vincular Mikrotik vía SSTP a VPS Emergent
# Pega este bloque en /system > New Terminal del Mikrotik.
# ============================================================

# 1) Crear el cliente VPN hacia tu VPS
/interface sstp-client
add name="VPN-Emergent" connect-to=134.209.69.231 user="root" password="B3nj4112593$#Hz" \\
    certificate=mikrotik_client.crt_0 profile=default-encryption disabled=no

# 2) Habilitar la API para que Emergent AI tome el control
/ip service
set api disabled=no port=8728 address=10.8.0.1/32 comment="API para Sincronizacion Emergent AI"

# 3) Crear usuario para el CRM
/user group add name=group-api policy=read,write,api,test,sensitive
/user add name="admin-emergent" password="prueba12345678" group=group-api
`;

/* ============================================================
   Test connection detail dialog
   ============================================================ */
function TestConnectionDialog({ device, open, onOpenChange }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !device) { setResult(null); setError(null); return; }
    (async () => {
      setRunning(true); setResult(null); setError(null);
      try {
        const { data } = await api.post(`/devices/${device.id}/ros-test`);
        setResult(data);
      } catch (e) {
        setError(formatApiError(e));
      } finally { setRunning(false); }
    })();
  }, [open, device]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${running ? "text-primary animate-pulse" : "text-primary"}`} />
            Prueba de conexión · {device?.name}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {device?.host}:{device?.api_port || 8728} · usuario <b>{device?.api_user || "—"}</b>
          </DialogDescription>
        </DialogHeader>
        {running && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Conectando al Mikrotik vía routeros_api…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 text-red-500 font-semibold">
              <XCircle className="w-4 h-4" /> Falló la conexión
            </div>
            <div className="text-xs mt-1 text-muted-foreground font-mono break-words">{error}</div>
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Conexión exitosa
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["Identity", result.identity],
                ["Board", result.board_name],
                ["Versión", result.version],
                ["Uptime", result.uptime],
                ["CPU load", result.cpu_load != null ? `${result.cpu_load}%` : "—"],
                ["CPU count", result.cpu_count],
                ["RAM libre", result.free_memory ? `${(result.free_memory / 1024 / 1024).toFixed(1)} MB` : "—"],
                ["RAM total", result.total_memory ? `${(result.total_memory / 1024 / 1024).toFixed(1)} MB` : "—"],
                ["Arquitectura", result.architecture],
                ["Plataforma", result.platform],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border/60 p-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
                  <div className="font-mono">{value ?? "—"}</div>
                </div>
              ))}
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

/* ============================================================
   Add / Edit dialog
   ============================================================ */
function MikrotikDialog({ open, onOpenChange, initial, onSaved }) {
  const isEdit = !!initial;
  const [f, setF] = useState({
    name: "",
    host: "",
    api_port: 8728,
    api_user: "admin-emergent",
    api_password: "",
    api_use_ssl: false,
    location: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setF({
        name: initial.name || "",
        host: initial.host || "",
        api_port: initial.api_port || 8728,
        api_user: initial.api_user || "admin-emergent",
        api_password: "", // never prefill password
        api_use_ssl: !!initial.api_use_ssl,
        location: initial.location || "",
        notes: initial.notes || "",
      });
    } else {
      setF({
        name: "",
        host: "10.8.0.2", // typical SSTP client tunnel address
        api_port: 8728,
        api_user: "admin-emergent",
        api_password: "prueba12345678",
        api_use_ssl: false,
        location: "",
        notes: "",
      });
    }
  }, [open, initial]);

  const submit = async () => {
    if (!f.name.trim()) return toast.error("El nombre es obligatorio");
    if (!f.host.trim()) return toast.error("El host es obligatorio");
    if (!f.api_user.trim()) return toast.error("El usuario API es obligatorio");
    if (!isEdit && !f.api_password.trim()) return toast.error("El password API es obligatorio al crear");

    setSaving(true);
    try {
      const payload = {
        name: f.name.trim(),
        kind: "mikrotik",
        host: f.host.trim(),
        api_port: Number(f.api_port) || 8728,
        api_user: f.api_user.trim(),
        api_use_ssl: !!f.api_use_ssl,
        api_enabled: true,
        location: f.location.trim(),
        notes: f.notes.trim(),
      };
      // Only send password if the user typed one (keep existing on edit)
      if (f.api_password.trim()) payload.api_password = f.api_password.trim();

      if (isEdit) {
        await api.patch(`/devices/${initial.id}`, payload);
        toast.success(`"${f.name}" actualizado`);
      } else {
        await api.post("/devices", payload);
        toast.success(`"${f.name}" agregado`);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RouterIcon className="w-4 h-4 text-primary" />
            {isEdit ? "Editar Mikrotik" : "Nuevo Mikrotik"}
          </DialogTitle>
          <DialogDescription>
            Configura la IP del router (por SSTP típicamente <span className="font-mono">10.8.0.2</span>) y las
            credenciales del usuario <span className="font-mono">admin-emergent</span> creado en el router.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nombre</Label>
            <Input data-testid="mk-name" value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ej: RB4011 Torre Norte" autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">Host / IP</Label>
              <Input data-testid="mk-host" value={f.host}
                onChange={(e) => setF({ ...f, host: e.target.value })}
                placeholder="10.8.0.2" className="font-mono" />
              <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                IP del router dentro del túnel SSTP (típicamente 10.8.0.2)
              </div>
            </div>
            <div>
              <Label className="text-xs">Puerto API</Label>
              <Input data-testid="mk-port" type="number" min="1" max="65535"
                value={f.api_port}
                onChange={(e) => setF({ ...f, api_port: e.target.value })}
                placeholder="8728" className="font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Usuario API</Label>
              <Input data-testid="mk-user" value={f.api_user}
                onChange={(e) => setF({ ...f, api_user: e.target.value })}
                placeholder="admin-emergent" className="font-mono" />
            </div>
            <div>
              <Label className="text-xs">
                Password API {isEdit && <span className="text-muted-foreground text-[10px] normal-case">(dejar vacío para conservar)</span>}
              </Label>
              <Input data-testid="mk-pass" type="password" value={f.api_password}
                onChange={(e) => setF({ ...f, api_password: e.target.value })}
                placeholder={isEdit ? "(sin cambios)" : "prueba12345678"} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={f.api_use_ssl}
              onChange={(e) => setF({ ...f, api_use_ssl: e.target.checked })}
              data-testid="mk-ssl" />
            Usar API-SSL (puerto 8729)
          </label>
          <div>
            <Label className="text-xs">Ubicación (opcional)</Label>
            <Input value={f.location}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              placeholder="Ej: Central Villahermosa" />
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea rows={2} value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Detalles, número de serie, contacto…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} data-testid="mk-save">
            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Agregar Mikrotik"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Setup Guide (collapsible) with the RouterOS bootstrap script
   ============================================================ */
function SetupGuide() {
  const [open, setOpen] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(SSTP_SETUP_SCRIPT);
    toast.success("Script copiado");
  };
  return (
    <div className="rounded-md border border-border bg-card mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-accent/40"
        data-testid="mk-setup-toggle"
      >
        <Terminal className="w-4 h-4 text-primary" />
        <div className="flex-1">
          <div className="font-semibold text-sm">Cómo vincular un Mikrotik (SSTP → VPS → API)</div>
          <div className="text-[11px] text-muted-foreground">
            Copia y pega este script en <span className="font-mono">/system → New Terminal</span> del router.
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono">SSTP → 134.209.69.231</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">API 8728 · restringida a 10.8.0.1/32</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">Usuario admin-emergent</Badge>
            <Button size="sm" variant="outline" onClick={copy} className="ml-auto"
              data-testid="mk-setup-copy">
              <Copy className="w-3.5 h-3.5 mr-1" /> Copiar script
            </Button>
          </div>
          <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre">
{SSTP_SETUP_SCRIPT}
          </pre>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-muted-foreground">
            <b className="text-primary">Después de pegar el script:</b> agrega este Mikrotik en la lista de abajo
            con host <span className="font-mono">10.8.0.2</span>, puerto <span className="font-mono">8728</span>,
            usuario <span className="font-mono">admin-emergent</span> y el password que definiste. Luego presiona
            "Probar conexión".
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PAGE ROOT
   ============================================================ */
export default function Mikrotik() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [askDelete, setAskDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/devices");
      setDevices(data.filter((d) => d.kind === "mikrotik"));
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return devices;
    return devices.filter((d) =>
      norm(`${d.name} ${d.host} ${d.api_user} ${d.location} ${d.notes}`).includes(nq)
    );
  }, [devices, q]);

  const startAdd = () => { setEditing(null); setDlgOpen(true); };
  const startEdit = (d) => { setEditing(d); setDlgOpen(true); };

  const confirmDelete = async () => {
    if (!askDelete) return;
    try {
      await api.delete(`/devices/${askDelete.id}`);
      toast.success(`"${askDelete.name}" eliminado`);
      setAskDelete(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const lastTestBadge = (d) => {
    if (!d.last_ros_test_at) {
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">sin probar</Badge>;
    }
    if (d.last_ros_test_ok) {
      return <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
        <CheckCircle2 className="w-3 h-3 mr-1" /> OK
      </Badge>;
    }
    return <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-500">
      <XCircle className="w-3 h-3 mr-1" /> Falló
    </Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Mikrotik"
        subtitle="Gestiona los routers Mikrotik del CRM. Cada uno se conecta al VPS vía SSTP y se controla desde aquí con su usuario API."
        actions={
          <Button onClick={startAdd} data-testid="mk-new-btn">
            <Plus className="w-4 h-4 mr-1" /> Nuevo Mikrotik
          </Button>
        }
      />

      <SetupGuide />

      <SearchBar
        value={q} onChange={setQ}
        placeholder="Buscar por nombre, host, usuario o ubicación…"
        hint={`${filtered.length} / ${devices.length}`}
        testId="mk-search"
      />

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Host · Puerto</TableHead>
              <TableHead>Usuario API</TableHead>
              <TableHead>Última prueba</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6">Cargando…</TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <EmptyRow colSpan={6} text={devices.length === 0
                ? "Aún no registras Mikrotiks. Presiona '+ Nuevo Mikrotik' para agregar el primero."
                : "Nada coincide con la búsqueda."} />
            )}
            {filtered.map((d) => (
              <TableRow key={d.id} data-testid={`mk-row-${d.id}`}>
                <TableCell>
                  <div className="font-medium flex items-center gap-2">
                    <RouterIcon className="w-3.5 h-3.5 text-primary" />
                    {d.name}
                  </div>
                  {d.notes && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{d.notes}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {d.host || "—"}
                  <span className="text-muted-foreground">:{d.api_port || 8728}</span>
                  {d.api_use_ssl && <Badge variant="outline" className="text-[10px] ml-1">SSL</Badge>}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <span className="flex items-center gap-1">
                    <KeyRound className="w-3 h-3 text-muted-foreground" />
                    {d.api_user || "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {lastTestBadge(d)}
                    {d.last_ros_test_at && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(d.last_ros_test_at).toLocaleString()}
                      </span>
                    )}
                    {d.ros_info?.board_name && (
                      <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                        <Cpu className="w-2.5 h-2.5" /> {d.ros_info.board_name}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.location || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setTesting(d)}
                    disabled={!d.host || !d.api_user}
                    data-testid={`mk-test-${d.id}`}
                    className="mr-1"
                    title={!d.host || !d.api_user ? "Configura host y usuario primero" : "Probar conexión RouterOS"}>
                    <Radio className="w-3.5 h-3.5 mr-1" /> Probar
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(d)}
                    data-testid={`mk-edit-${d.id}`} title="Editar">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setAskDelete(d)}
                    data-testid={`mk-del-${d.id}`} title="Eliminar">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MikrotikDialog
        open={dlgOpen}
        onOpenChange={setDlgOpen}
        initial={editing}
        onSaved={load}
      />

      <TestConnectionDialog
        device={testing}
        open={!!testing}
        onOpenChange={(v) => { if (!v) { setTesting(null); load(); } }}
      />

      <AlertDialog open={!!askDelete} onOpenChange={(v) => { if (!v) setAskDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              Eliminar "{askDelete?.name}"
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará este Mikrotik del CRM. El script SSTP y el usuario en el router seguirán existiendo del lado del equipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="mk-del-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid="mk-del-confirm"
              className="bg-destructive hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
