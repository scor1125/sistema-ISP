import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow, Kpi, SearchBar, norm } from "@/components/Common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Radio, AlertTriangle, Plus, RefreshCw, Wifi, WifiOff, Pencil, Trash2,
  ShieldCheck, ShieldAlert, Signal, ArrowUpFromLine, ArrowDownToLine,
  Zap, Save,
} from "lucide-react";
import { toast } from "sonner";

const VENDOR_LABELS = {
  vsol_epon: "VSol EPON (V1600D/E)",
  vsol_gpon: "VSol GPON (V1600GT/G0)",
  huawei: "Huawei (MA5680/MA5800)",
  zte: "ZTE (C300/C320)",
  fiberhome: "Fiberhome (AN5516)",
  cdata: "C-Data (FD1104/FD1116)",
  bdcom: "BDCOM",
  custom: "Otra / Personalizado",
};

const emptyOlt = () => ({
  name: "",
  kind: "olt",
  host: "",
  location: "",
  connection: "public_ip",
  olt_vendor: "vsol_epon",
  snmp_enabled: true,
  snmp_community: "public",
  snmp_version: "2c",
  snmp_port: 161,
  snmp_timeout: 3,
});

function OltFormDialog({ open, onOpenChange, initial, onSaved }) {
  const [f, setF] = useState(emptyOlt());
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(initial ? { ...emptyOlt(), ...initial } : emptyOlt()); }, [initial, open]);

  const save = async () => {
    if (!f.name.trim()) return toast.error("Ponle un nombre a la OLT");
    if (!f.host.trim()) return toast.error("Falta la IP / host de la OLT");
    setSaving(true);
    try {
      if (initial?.id) {
        await api.patch(`/devices/${initial.id}`, f);
        toast.success("OLT actualizada");
      } else {
        await api.post("/devices", f);
        toast.success("OLT registrada");
      }
      onOpenChange(false);
      onSaved?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Editar OLT · ${initial.name}` : "Nueva OLT"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Nombre</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                placeholder="OLT-Central-VSol" data-testid="olt-name-input" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Host / IP</Label>
              <Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })}
                placeholder="192.168.1.100 o vpn.milsp.com" data-testid="olt-host-input" />
            </div>
            <div>
              <Label className="text-xs">Vendor</Label>
              <Select value={f.olt_vendor} onValueChange={(v) => setF({ ...f, olt_vendor: v })}>
                <SelectTrigger data-testid="olt-vendor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(VENDOR_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Ubicación</Label>
              <Input value={f.location || ""} onChange={(e) => setF({ ...f, location: e.target.value })}
                placeholder="Site A / Nodo Norte" />
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono flex-1">SNMP</div>
              <Switch
                checked={!!f.snmp_enabled}
                onCheckedChange={(v) => setF({ ...f, snmp_enabled: v })}
                data-testid="olt-snmp-enabled"
              />
              <span className="text-xs">{f.snmp_enabled ? "habilitado" : "deshabilitado"}</span>
            </div>

            {f.snmp_enabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Versión</Label>
                  <Select value={f.snmp_version} onValueChange={(v) => setF({ ...f, snmp_version: v })}>
                    <SelectTrigger data-testid="olt-snmp-version"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2c">v2c (community)</SelectItem>
                      <SelectItem value="v3">v3 (user + auth)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Puerto UDP</Label>
                  <Input type="number" value={f.snmp_port || 161}
                    onChange={(e) => setF({ ...f, snmp_port: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Community string</Label>
                  <Input value={f.snmp_community || ""}
                    onChange={(e) => setF({ ...f, snmp_community: e.target.value })}
                    placeholder="public"
                    data-testid="olt-snmp-community" />
                </div>
                <div>
                  <Label className="text-xs">Timeout (segundos)</Label>
                  <Input type="number" value={f.snmp_timeout || 3}
                    onChange={(e) => setF({ ...f, snmp_timeout: Number(e.target.value) })} />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="olt-save">
            <Save className="w-4 h-4 mr-1" /> {saving ? "Guardando…" : (initial ? "Guardar cambios" : "Registrar OLT")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OltCard({ olt, onEdit, onDelete, onTest, onSync, testing, syncing }) {
  const status = olt.last_sync_status;
  return (
    <div className="rounded-md border border-border p-3 bg-card space-y-2" data-testid={`olt-card-${olt.id}`}>
      <div className="flex items-start gap-2">
        <div className={`w-10 h-10 rounded-md grid place-items-center shrink-0 ${
          status === "ok" ? "bg-emerald-500/15 text-emerald-500"
          : status === "error" ? "bg-red-500/15 text-red-500"
          : "bg-muted text-muted-foreground"
        }`}>
          <Radio className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{olt.name}</div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {olt.host} · {VENDOR_LABELS[olt.olt_vendor] || olt.olt_vendor || "sin vendor"}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(olt)}
            data-testid={`olt-edit-${olt.id}`}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(olt)}
            data-testid={`olt-del-${olt.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {olt.snmp_enabled ? (
          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
            <ShieldCheck className="w-3 h-3 mr-1" /> SNMP {olt.snmp_version || "2c"}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            <ShieldAlert className="w-3 h-3 mr-1" /> SNMP deshabilitado
          </Badge>
        )}
        {typeof olt.onus_count === "number" && (
          <Badge variant="outline" className="text-[10px]">
            {olt.onus_count} ONUs · {olt.onus_online ?? 0} online
          </Badge>
        )}
        {olt.last_sync_at && (
          <span className="text-[10px] text-muted-foreground font-mono">
            última: {new Date(olt.last_sync_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {olt.last_sync_error && (
        <div className="text-[11px] text-red-500 truncate" title={olt.last_sync_error}>
          ✗ {olt.last_sync_error}
        </div>
      )}
      {olt.sys_descr && (
        <div className="text-[10px] text-muted-foreground italic truncate" title={olt.sys_descr}>
          {olt.sys_descr}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button size="sm" variant="outline" onClick={() => onTest(olt)} disabled={testing || !olt.snmp_enabled}
          data-testid={`olt-test-${olt.id}`}>
          <Zap className={`w-3.5 h-3.5 mr-1 ${testing ? "animate-pulse" : ""}`} />
          {testing ? "Probando…" : "Probar SNMP"}
        </Button>
        <Button size="sm" onClick={() => onSync(olt)} disabled={syncing || !olt.snmp_enabled}
          data-testid={`olt-sync-${olt.id}`} className="ml-auto">
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando…" : "Sincronizar ONUs"}
        </Button>
      </div>
    </div>
  );
}

export default function OLT() {
  const [olts, setOlts] = useState([]);
  const [config, setConfig] = useState(null);
  const [q, setQ] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedOltId, setSelectedOltId] = useState(null);
  const [snmpData, setSnmpData] = useState(null);  // per-OLT snapshot from GET /devices/{id}/onus
  const [testing, setTesting] = useState({});
  const [syncing, setSyncing] = useState({});
  const [simOnus, setSimOnus] = useState([]);   // fallback simulated ONUs

  const load = useCallback(async () => {
    try {
      const [d, c, sim] = await Promise.all([
        api.get("/devices"),
        api.get("/config"),
        api.get("/onus").catch(() => ({ data: [] })),
      ]);
      const oltList = d.data.filter((x) => x.kind === "olt");
      setOlts(oltList);
      setConfig(c.data);
      setSimOnus(sim.data || []);
      // Auto-select first OLT if none selected
      if (!selectedOltId && oltList.length > 0) {
        setSelectedOltId(oltList[0].id);
      }
    } catch (e) { toast.error(formatApiError(e)); }
  }, [selectedOltId]);

  const loadOnus = useCallback(async (oltId) => {
    if (!oltId) { setSnmpData(null); return; }
    try {
      const { data } = await api.get(`/devices/${oltId}/onus`);
      setSnmpData(data);
    } catch (e) {
      setSnmpData(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOnus(selectedOltId); }, [selectedOltId, loadOnus]);

  const testSnmp = async (olt) => {
    setTesting((s) => ({ ...s, [olt.id]: true }));
    try {
      const { data } = await api.post(`/devices/${olt.id}/snmp-test`);
      if (data.ok) {
        toast.success(`SNMP OK · ${data.sys_name || data.host}${data.if_number ? ` · ${data.if_number} ifs` : ""}`);
      } else {
        toast.error(`SNMP falló: ${data.error || "sin respuesta"}`);
      }
      load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setTesting((s) => ({ ...s, [olt.id]: false })); }
  };

  const syncOnus = async (olt) => {
    setSyncing((s) => ({ ...s, [olt.id]: true }));
    try {
      const { data } = await api.post(`/devices/${olt.id}/onu-sync`);
      toast.success(`${data.onus_count} ONUs sincronizadas · ${data.onus_online} online`);
      setSelectedOltId(olt.id);
      await load();
      await loadOnus(olt.id);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSyncing((s) => ({ ...s, [olt.id]: false })); }
  };

  const del = async (olt) => {
    if (!window.confirm(`¿Eliminar la OLT "${olt.name}" y todas sus ONUs sincronizadas?`)) return;
    try {
      await api.delete(`/devices/${olt.id}`);
      toast.success("OLT eliminada");
      if (selectedOltId === olt.id) setSelectedOltId(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  // Determine which ONU list to render
  const hasRealData = snmpData && snmpData.onus && snmpData.onus.length > 0;
  const onusList = hasRealData ? snmpData.onus : simOnus;
  const isReal = hasRealData;

  const high = config?.onu_power_high_threshold ?? -8;
  const low = config?.onu_power_low_threshold ?? -27;

  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return onusList;
    return onusList.filter((o) => norm(
      isReal
        ? `${o.name} ${o.mac} ${o.index} ${o.status}`
        : `${o.full_name} ${o.onu_serial} ${o.ip_address} ${o.mikrotik_server}`
    ).includes(nq));
  }, [onusList, q, isReal]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (isReal) return arr.sort((a, b) => (a.rx_dbm ?? 999) - (b.rx_dbm ?? 999));
    return arr.sort((a, b) => (a.power_dbm ?? 999) - (b.power_dbm ?? 999));
  }, [filtered, isReal]);

  const critical = useMemo(() => {
    return sorted.filter((o) => {
      const p = isReal ? o.rx_dbm : o.power_dbm;
      return p != null && (p > high || p < low);
    }).length;
  }, [sorted, isReal, high, low]);

  const avg = useMemo(() => {
    const values = onusList.map((o) => (isReal ? o.rx_dbm : o.power_dbm)).filter((v) => v != null);
    if (!values.length) return "—";
    return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
  }, [onusList, isReal]);

  return (
    <div>
      <PageHeader
        title="OLT / ONUs"
        subtitle={
          isReal
            ? `Datos en vivo vía SNMP · umbral alto: ${high} dBm, umbral bajo: ${low} dBm`
            : `Datos simulados. Registra una OLT abajo y sincroniza vía SNMP para ver datos reales. Umbral alto: ${high}, bajo: ${low}`
        }
        actions={
          <Button onClick={() => { setEditing(null); setOpenForm(true); }} data-testid="olt-new-btn">
            <Plus className="w-4 h-4 mr-1" /> Nueva OLT
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi label="ONUs monitoreadas" value={onusList.length} testId="kpi-onus" />
        <Kpi label="Potencia RX promedio" value={`${avg} dBm`} tone="info" />
        <Kpi label="Fuera de umbral" value={critical} tone="danger"
          trend={<span className="inline-flex gap-1"><AlertTriangle className="w-3 h-3" /> Requieren revisión</span>} />
        <Kpi label="OLTs registradas" value={olts.length} tone="success"
          trend={<span className="inline-flex gap-1"><Radio className="w-3 h-3" /> {olts.filter((o) => o.snmp_enabled).length} con SNMP</span>} />
      </div>

      {/* OLT registration + sync cards */}
      {olts.length > 0 && (
        <div className="space-y-2 mb-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Equipos registrados</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {olts.map((olt) => (
              <OltCard
                key={olt.id}
                olt={olt}
                onEdit={(o) => { setEditing(o); setOpenForm(true); }}
                onDelete={del}
                onTest={testSnmp}
                onSync={syncOnus}
                testing={!!testing[olt.id]}
                syncing={!!syncing[olt.id]}
              />
            ))}
          </div>
        </div>
      )}

      {olts.length > 1 && (
        <div className="mb-3">
          <Label className="text-xs">Ver ONUs de:</Label>
          <Select value={selectedOltId || ""} onValueChange={setSelectedOltId}>
            <SelectTrigger className="max-w-md" data-testid="olt-selector"><SelectValue /></SelectTrigger>
            <SelectContent>
              {olts.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} ({o.onus_count ?? 0} ONUs · {o.snmp_enabled ? "SNMP" : "sin SNMP"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <SearchBar value={q} onChange={setQ} placeholder={isReal ? "Buscar por nombre, MAC o índice…" : "Buscar por cliente, serial ONU, IP…"}
        hint={`${sorted.length} / ${onusList.length}${isReal ? " (SNMP en vivo)" : " (simulado)"}`} testId="olt-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden">
        {isReal ? (
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead>
              <TableHead>Nombre / Serial</TableHead>
              <TableHead>MAC</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right"><ArrowDownToLine className="w-3.5 h-3.5 inline" /> RX</TableHead>
              <TableHead className="text-right"><ArrowUpFromLine className="w-3.5 h-3.5 inline" /> TX</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sorted.length === 0 && <EmptyRow colSpan={6} text="Sin ONUs sincronizadas. Presiona 'Sincronizar ONUs' en la tarjeta de la OLT." />}
              {sorted.map((o) => {
                const bad = o.rx_dbm != null && (o.rx_dbm > high || o.rx_dbm < low);
                return (
                  <TableRow key={o.index} className={o.status === "offline" ? "opacity-60" : ""}>
                    <TableCell className="font-mono text-xs">{o.index}</TableCell>
                    <TableCell className="font-medium">{o.name || <span className="text-muted-foreground italic">(sin nombre)</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{o.mac || "—"}</TableCell>
                    <TableCell>
                      {o.status === "online" ? (
                        <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40 text-[10px]">
                          <Wifi className="w-3 h-3 mr-1" /> online
                        </Badge>
                      ) : o.status === "los" ? (
                        <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px]">LOS</Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-500 border-red-500/40 text-[10px]">
                          <WifiOff className="w-3 h-3 mr-1" /> {o.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${bad ? "text-red-400" : "text-emerald-400"}`}>
                      {o.rx_dbm != null ? `${o.rx_dbm.toFixed(2)} dBm` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {o.tx_dbm != null ? `${o.tx_dbm.toFixed(2)} dBm` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Cliente</TableHead><TableHead>ONU serial</TableHead>
              <TableHead>Potencia</TableHead><TableHead>RX/TX</TableHead>
              <TableHead>IP</TableHead><TableHead>Estado</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sorted.length === 0 && <EmptyRow colSpan={6} text="Sin ONUs. Crea clientes con serial ONU o registra una OLT con SNMP para ver datos reales." />}
              {sorted.map((o) => {
                const bad = o.power_dbm != null && (o.power_dbm > high || o.power_dbm < low);
                return (
                  <TableRow key={o.client_id}>
                    <TableCell className="font-medium">{o.full_name}</TableCell>
                    <TableCell className="font-mono text-xs">{o.onu_serial}</TableCell>
                    <TableCell className="font-mono">
                      <span className={bad ? "text-red-400" : "text-emerald-400"}>{o.power_dbm} dBm</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.rx_mbps}↓ / {o.tx_mbps}↑</TableCell>
                    <TableCell className="font-mono text-xs">{o.ip_address}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={bad ? "border-red-500/30 text-red-400 bg-red-500/10" : "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"}>
                        {bad ? "Fuera de umbral" : "OK"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <OltFormDialog
        open={openForm}
        onOpenChange={setOpenForm}
        initial={editing}
        onSaved={load}
      />
    </div>
  );
}
