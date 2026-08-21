import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ShieldCheck, Loader2, FileCode, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

/* Los dos dialectos de RouterOS. Ambos usan el mismo túnel (TCP, AES-256-CBC
   con SHA1); lo único que cambia es cómo se llama el cifrado en cada versión,
   y RouterOS rechaza el nombre de la otra. */
const ROS_PROFILES = [
  { value: "v7", title: "RouterOS 7.x", hint: "cipher aes256-cbc" },
  { value: "v6", title: "RouterOS 6.x", hint: "cipher aes256" },
];

const VPN_STATUS = {
  online:  { label: "En línea",  cls: "border-emerald-500/40 text-emerald-500" },
  offline: { label: "Sin conexión", cls: "border-red-500/40 text-red-500" },
  pending: { label: "Pendiente", cls: "border-amber-500/40 text-amber-500" },
  revoked: { label: "Revocado",  cls: "border-muted-foreground/40 text-muted-foreground" },
};

/* ============================================================
   Resultado de la prueba de conexión (compartido)
   ============================================================ */
function TestResult({ state, result, error }) {
  if (state === "running") {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Probando conexión con el router…
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
        <div className="flex items-center gap-2 text-red-500 font-semibold">
          <XCircle className="w-4 h-4" /> Sin éxito
        </div>
        <div className="text-xs mt-1 text-muted-foreground break-words">{error}</div>
        <ul className="text-[11px] text-muted-foreground mt-2 list-disc pl-4 space-y-0.5">
          <li>Verifica que pegaste el script completo en el router.</li>
          <li>En el router, <span className="font-mono">/interface ovpn-client print</span> debe mostrar la bandera <b>R</b>.</li>
          <li>Si el perfil no coincide con la versión del router, el cifrado no cuadra: prueba el otro.</li>
        </ul>
      </div>
    );
  }
  if (state === "ok" && result) {
    return (
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
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border/60 p-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
              <div className="font-mono">{value ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

/* Corre la prueba real contra el router (API de RouterOS por el túnel). */
function useConnectionTest(device) {
  const [state, setState] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    if (!device) return;
    setState("running"); setResult(null); setError(null);
    try {
      const { data } = await api.post(`/devices/${device.id}/ros-test`);
      setResult(data); setState("ok");
    } catch (e) {
      setError(formatApiError(e)); setState("error");
    }
  }, [device]);

  const reset = useCallback(() => {
    setState("idle"); setResult(null); setError(null);
  }, []);

  return { state, result, error, run, reset };
}

/* ============================================================
   Script de vinculación OpenVPN + prueba, todo en un diálogo
   ============================================================ */
function LinkScriptDialog({ device, open, onOpenChange, onDone }) {
  const [version, setVersion] = useState("v7");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const test = useConnectionTest(device);

  const provision = useCallback(async (v, regenerate = false) => {
    if (!device) return;
    setLoading(true);
    try {
      const { data: d } = await api.post(`/devices/${device.id}/openvpn-provision`,
                                         { version: v, regenerate });
      setData(d);
      if (regenerate) toast.success("Credenciales nuevas generadas");
    } catch (e) {
      toast.error(formatApiError(e));
      if (!regenerate) setData(null);
    } finally { setLoading(false); }
  }, [device]);

  // Invalida las credenciales anteriores: el router deja de conectar hasta que
  // le peguen el script nuevo, así que se confirma antes.
  const regenerate = () => {
    if (!window.confirm(
      "Se generarán una contraseña de VPN y una de API nuevas.\n\n" +
      "El router perderá la conexión hasta que le pegues el script actualizado. ¿Continuar?"
    )) return;
    test.reset();
    provision(version, true);
  };

  useEffect(() => {
    if (!open || !device) { setData(null); test.reset(); return; }
    const v = device.ros_version || "v7";
    setVersion(v);
    provision(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device]);

  const changeVersion = (v) => {
    if (v === version) return;
    setVersion(v);
    test.reset();
    provision(v);
  };

  const copy = async () => {
    if (!data?.script) return;
    if (await copyToClipboard(data.script)) toast.success("Script copiado");
    else toast.error("No se pudo copiar — selecciona el texto y usa Ctrl+C");
  };

  const close = (v) => { if (!v) onDone?.(); onOpenChange(v); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-primary" />
            Vincular "{device?.name}" por OpenVPN
          </DialogTitle>
          <DialogDescription>
            Elige la versión de tu RouterOS, copia el script y pégalo en{" "}
            <span className="font-mono">/system → New Terminal</span> del router. Luego prueba la conexión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <div>
            <Label className="text-xs mb-1.5 block">1 · Versión de tu RouterOS</Label>
            <Tabs value={version} onValueChange={changeVersion}>
              <TabsList className="w-full">
                {ROS_PROFILES.map((p) => (
                  <TabsTrigger key={p.value} value={p.value} className="flex-1 flex-col py-1.5 h-auto"
                    data-testid={`mk-ver-${p.value}`}>
                    <span className="text-xs font-medium">{p.title}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{p.hint}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="text-[11px] text-muted-foreground mt-1">
              ¿No sabes cuál? En el router, <span className="font-mono">/system resource print</span> muestra
              la versión. Si el túnel no levanta, prueba con el otro perfil.
            </div>
          </div>

          {loading && (
            <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generando credenciales…
            </div>
          )}

          {!loading && data && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {data.protocol?.toUpperCase()} → {data.public_ip}:{data.port}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono">
                  IP del túnel: {data.tunnel_ip}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono">
                  API {data.api_user}
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={regenerate} disabled={loading}
                    data-testid="mk-script-regen" title="Generar contraseñas nuevas">
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Regenerar
                  </Button>
                  <Button size="sm" variant="outline" onClick={copy}
                    data-testid="mk-script-copy">
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copiar script
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">
                  2 · Pega esto en el terminal del Mikrotik
                  <span className="ml-1 font-normal normal-case text-muted-foreground">
                    (si el botón de copiar no funciona, haz clic en el recuadro y usa Ctrl+C)
                  </span>
                </Label>
                <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 whitespace-pre-wrap break-words max-h-72 overflow-y-auto select-all">
{data.script}
                </pre>
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">3 · Comprueba que quedó conectado</Label>
                <Button onClick={test.run} disabled={test.state === "running"}
                  data-testid="mk-script-test" className="w-full">
                  <Radio className={`w-4 h-4 mr-1 ${test.state === "running" ? "animate-pulse" : ""}`} />
                  Probar conexión
                </Button>
              </div>

              <TestResult state={test.state} result={test.result} error={test.error} />

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
                <b className="text-amber-500">Guarda esto:</b> la contraseña de la VPN y la del usuario API se
                muestran solo aquí. Puedes volver a abrir esta ventana cuando quieras — el script se regenera igual,
                sin cambiar las credenciales ni la IP del router.
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Prueba de conexión suelta (botón de la tabla)
   ============================================================ */
function TestConnectionDialog({ device, open, onOpenChange }) {
  const test = useConnectionTest(device);

  useEffect(() => {
    if (open && device) test.run();
    else test.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            Prueba de conexión · {device?.name}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {device?.host}:{device?.api_port || 8728} · usuario <b>{device?.api_user || "—"}</b>
          </DialogDescription>
        </DialogHeader>
        <TestResult state={test.state} result={test.result} error={test.error} />
        <DialogFooter>
          <Button variant="outline" onClick={test.run} disabled={test.state === "running"}>
            Reintentar
          </Button>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Alta / edición
   ============================================================ */
function MikrotikDialog({ open, onOpenChange, initial, onSaved }) {
  const isEdit = !!initial;
  const empty = {
    name: "", ros_version: "v7", location: "", notes: "",
    host: "", api_port: 8728, api_user: "", api_password: "", api_use_ssl: false,
  };
  const [f, setF] = useState(empty);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAdvanced(false);
    setF(initial ? {
      name: initial.name || "",
      ros_version: initial.ros_version || "v7",
      location: initial.location || "",
      notes: initial.notes || "",
      host: initial.host || "",
      api_port: initial.api_port || 8728,
      api_user: initial.api_user || "",
      api_password: "",
      api_use_ssl: !!initial.api_use_ssl,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async () => {
    if (!f.name.trim()) return toast.error("El nombre es obligatorio");
    setSaving(true);
    try {
      const payload = {
        name: f.name.trim(),
        kind: "mikrotik",
        ros_version: f.ros_version,
        location: f.location.trim(),
        notes: f.notes.trim(),
        api_use_ssl: !!f.api_use_ssl,
        api_port: Number(f.api_port) || 8728,
      };
      // En alta, host/usuario los asigna el aprovisionamiento de la VPN.
      if (f.host.trim()) payload.host = f.host.trim();
      if (f.api_user.trim()) payload.api_user = f.api_user.trim();
      if (f.api_password.trim()) payload.api_password = f.api_password.trim();

      if (isEdit) {
        await api.patch(`/devices/${initial.id}`, payload);
        toast.success(`"${f.name}" actualizado`);
        onSaved?.(null);
      } else {
        if (!payload.host) payload.host = "-";  // lo reemplaza la IP del túnel
        const { data } = await api.post("/devices", payload);
        toast.success(`"${f.name}" agregado`);
        onSaved?.(data);   // abre el diálogo del script
      }
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
            {isEdit
              ? "Cambia los datos del router. Para regenerar el script de vinculación usa el botón «Script»."
              : "Solo necesitas el nombre y la versión. El CRM genera las credenciales de la VPN y el script para el router."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nombre</Label>
            <Input data-testid="mk-name" value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ej: RB4011 Torre Norte" autoFocus />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Versión de RouterOS</Label>
            <Tabs value={f.ros_version} onValueChange={(v) => setF({ ...f, ros_version: v })}>
              <TabsList className="w-full">
                {ROS_PROFILES.map((p) => (
                  <TabsTrigger key={p.value} value={p.value} className="flex-1 flex-col py-1.5 h-auto"
                    data-testid={`mk-new-ver-${p.value}`}>
                    <span className="text-xs font-medium">{p.title}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{p.hint}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

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

          <button type="button" onClick={() => setAdvanced((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="mk-advanced-toggle">
            {advanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Opciones avanzadas (host y API manuales)
          </button>

          {advanced && (
            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div className="text-[11px] text-muted-foreground">
                Normalmente no hace falta tocar esto: la IP del túnel y el usuario API los asigna
                el CRM al generar el script.
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">Host / IP en el túnel</Label>
                  <Input data-testid="mk-host" value={f.host}
                    onChange={(e) => setF({ ...f, host: e.target.value })}
                    placeholder="(automático)" className="font-mono" />
                </div>
                <div>
                  <Label className="text-xs">Puerto API</Label>
                  <Input data-testid="mk-port" type="number" min="1" max="65535"
                    value={f.api_port}
                    onChange={(e) => setF({ ...f, api_port: e.target.value })}
                    className="font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Usuario API</Label>
                  <Input data-testid="mk-user" value={f.api_user}
                    onChange={(e) => setF({ ...f, api_user: e.target.value })}
                    placeholder="(automático)" className="font-mono" />
                </div>
                <div>
                  <Label className="text-xs">
                    Password API{" "}
                    <span className="text-muted-foreground text-[10px] normal-case">(vacío = sin cambios)</span>
                  </Label>
                  <Input data-testid="mk-pass" type="password" value={f.api_password}
                    onChange={(e) => setF({ ...f, api_password: e.target.value })}
                    placeholder="(automático)" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={f.api_use_ssl}
                  onChange={(e) => setF({ ...f, api_use_ssl: e.target.checked })}
                  data-testid="mk-ssl" />
                Usar API-SSL (puerto 8729)
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} data-testid="mk-save">
            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Agregar y generar script"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Guía corta del flujo
   ============================================================ */
function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-card mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-accent/40"
        data-testid="mk-setup-toggle"
      >
        <Terminal className="w-4 h-4 text-primary" />
        <div className="flex-1">
          <div className="font-semibold text-sm">Cómo vincular un Mikrotik (OpenVPN → CRM → API)</div>
          <div className="text-[11px] text-muted-foreground">
            El router se conecta solo hacia el CRM, así que sirve también detrás de CGNAT o IP dinámica.
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="border-t border-border p-4 space-y-2 text-sm">
          <ol className="space-y-2">
            {[
              ["Agrega el router", "Presiona «+ Nuevo Mikrotik», ponle nombre y elige la versión de RouterOS."],
              ["Copia el script", "El CRM genera usuario, contraseña y una IP fija dentro del túnel para ese router."],
              ["Pégalo en el router", "En Winbox/WebFig: /system → New Terminal, pega y presiona Enter."],
              ["Prueba la conexión", "Si el túnel levantó, dirá «Conexión exitosa» y traerá los datos del equipo."],
            ].map(([t, s], i) => (
              <li key={t} className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs grid place-items-center flex-shrink-0 font-mono mt-0.5">
                  {i + 1}
                </span>
                <span><b>{t}.</b> <span className="text-muted-foreground">{s}</span></span>
              </li>
            ))}
          </ol>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-muted-foreground flex gap-2">
            <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0" />
            <span>
              Cada router usa credenciales propias y la API queda abierta <b>solo</b> hacia el CRM por dentro
              del túnel, nunca hacia internet. Al eliminar un router aquí, su acceso VPN se revoca.
            </span>
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
  const [scripting, setScripting] = useState(null);
  const [askDelete, setAskDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  // Tras crear, abrimos directo el script del router recién agregado.
  const afterSave = (created) => {
    load();
    if (created) setScripting(created);
  };

  const confirmDelete = async () => {
    if (!askDelete) return;
    setDeleting(true);
    try {
      // Primero revocamos la VPN: el borrado genérico de /devices no sabe de
      // credenciales, y dejarlas vivas permitiría reconectar un equipo dado de baja.
      try {
        await api.post(`/devices/${askDelete.id}/openvpn-revoke`);
      } catch (e) {
        console.warn("no se pudo revocar la VPN", e);
      }
      await api.delete(`/devices/${askDelete.id}`);
      toast.success(`"${askDelete.name}" eliminado`);
      setAskDelete(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setDeleting(false); }
  };

  const statusBadge = (d) => {
    const st = d.vpn_status || (d.last_ros_test_at ? (d.last_ros_test_ok ? "online" : "offline") : null);
    if (!st) {
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">sin vincular</Badge>;
    }
    const s = VPN_STATUS[st] || VPN_STATUS.pending;
    const Icon = st === "online" ? CheckCircle2 : st === "offline" ? XCircle : Radio;
    return (
      <Badge variant="outline" className={`text-[10px] ${s.cls}`}>
        <Icon className="w-3 h-3 mr-1" /> {s.label}
      </Badge>
    );
  };

  return (
    <div>
      <PageHeader
        title="Mikrotik"
        subtitle="Gestiona los routers Mikrotik del CRM. Cada uno se conecta por OpenVPN hacia el servidor y se controla desde aquí con su usuario API."
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
              <TableHead>Estado</TableHead>
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
                    {d.ros_version && (
                      <Badge variant="outline" className="text-[9px] font-mono uppercase">
                        {d.ros_version}
                      </Badge>
                    )}
                  </div>
                  {d.notes && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{d.notes}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {d.host && d.host !== "-" ? d.host : <span className="text-muted-foreground italic">sin vincular</span>}
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
                    {statusBadge(d)}
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
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => setScripting(d)}
                    data-testid={`mk-script-${d.id}`} className="mr-1" title="Ver script de vinculación">
                    <FileCode className="w-3.5 h-3.5 mr-1" /> Script
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTesting(d)}
                    disabled={!d.host || d.host === "-" || !d.api_user}
                    data-testid={`mk-test-${d.id}`}
                    className="mr-1"
                    title={!d.host || d.host === "-" || !d.api_user
                      ? "Genera primero el script de vinculación"
                      : "Probar conexión RouterOS"}>
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
        onSaved={afterSave}
      />

      <LinkScriptDialog
        device={scripting}
        open={!!scripting}
        onOpenChange={(v) => { if (!v) setScripting(null); }}
        onDone={load}
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
              Se elimina del CRM y se revoca su acceso VPN, así que el router ya no podrá reconectar.
              La configuración que quedó dentro del equipo no se toca: si lo vuelves a agregar, hay que
              pegarle el script nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="mk-del-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} data-testid="mk-del-confirm"
              className="bg-destructive hover:bg-destructive/90">
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
