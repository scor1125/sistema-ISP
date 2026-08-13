import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  RefreshCw, ShieldAlert, ShieldCheck, AlertTriangle, Search, Wifi, WifiOff,
  Activity, ArrowDownToLine, ArrowUpFromLine, Ban, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

const norm = (s) => (s || "").toString().toLowerCase();

const humanBytes = (n) => {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v < 1024 * 1024 * 1024 * 1024) return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(v / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
};

export default function MikrotikInterfacesDialog({ device, open, onOpenChange }) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [state, setState] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState(null);

  const configured = !!(device?.rest_api_url && device?.api_user && device?.api_password);

  const load = async () => {
    if (!device) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/devices/${device.id}/interfaces`);
      setState(data);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const sync = async () => {
    if (!device) return;
    if (!configured) {
      toast.error("Falta URL REST, usuario o contraseña API. Edita el router primero.");
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const { data } = await api.post(`/devices/${device.id}/rest-sync`);
      setState({
        device_id: data.device_id,
        last_sync_at: data.synced_at,
        last_sync_status: "ok",
        last_sync_error: "",
        interfaces_count: data.interfaces_count,
        interfaces_down: data.interfaces_down,
        interfaces: data.interfaces,
      });
      toast.success(
        `Sincronizado · ${data.interfaces_count} interfaces` +
        (data.interfaces_down > 0 ? ` · ${data.interfaces_down} caídas` : "")
      );
    } catch (e) {
      const msg = formatApiError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (open && device) { setState(null); setQ(""); load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device?.id]);

  const interfaces = useMemo(() => state?.interfaces || [], [state?.interfaces]);
  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return interfaces;
    return interfaces.filter((i) =>
      norm(`${i.name} ${i.type} ${i.mac_address} ${i.comment}`).includes(nq)
    );
  }, [interfaces, q]);

  const downIfaces = interfaces.filter((i) => i.running === false && i.disabled !== true);
  const disabledIfaces = interfaces.filter((i) => i.disabled === true);
  const upCount = interfaces.filter((i) => i.running === true).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="mk-interfaces-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Interfaces · {device?.name}
          </DialogTitle>
        </DialogHeader>

        {/* Config summary card */}
        <div className="rounded-md border border-border p-3 bg-muted/20 space-y-1">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
            <div className="flex items-center gap-2">
              {configured ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span className="text-muted-foreground">URL REST:</span>
              <span data-testid="mk-rest-url">{device?.rest_api_url || <span className="text-amber-500 italic">no configurada</span>}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Usuario API: </span>
              <span data-testid="mk-rest-user">{device?.api_user || <span className="text-amber-500 italic">no configurado</span>}</span>
            </div>
            <div>
              <span className="text-muted-foreground">TLS verify: </span>
              <span>{device?.rest_verify_ssl ? "sí" : "no (self-signed)"}</span>
            </div>
          </div>
          {state?.last_sync_at && (
            <div className="text-[11px] text-muted-foreground">
              Última sincronización: {new Date(state.last_sync_at).toLocaleString()}
              {state?.last_sync_status === "ok" ? (
                <Badge variant="outline" className="ml-2 border-emerald-500/50 text-emerald-500 text-[10px]">ok</Badge>
              ) : state?.last_sync_status === "error" ? (
                <Badge variant="outline" className="ml-2 border-red-500/50 text-red-500 text-[10px]">error</Badge>
              ) : null}
            </div>
          )}
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={sync}
            disabled={syncing || !configured}
            data-testid="mk-sync-now-btn"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar interfaz por nombre, tipo, MAC o comentario…"
              className="pl-8"
              data-testid="mk-if-search"
            />
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {filtered.length} / {interfaces.length}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-1 text-emerald-500 text-xs uppercase tracking-widest font-mono">
              <Wifi className="w-3.5 h-3.5" /> Activas
            </div>
            <div className="text-2xl font-semibold" data-testid="mk-if-up">{upCount}</div>
          </div>
          <div className={`rounded-md border p-3 ${downIfaces.length ? "border-red-500/40 bg-red-500/10" : "border-border bg-muted/10"}`}>
            <div className={`flex items-center gap-1 text-xs uppercase tracking-widest font-mono ${downIfaces.length ? "text-red-500" : "text-muted-foreground"}`}>
              <WifiOff className="w-3.5 h-3.5" /> Caídas
            </div>
            <div className="text-2xl font-semibold" data-testid="mk-if-down">{downIfaces.length}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-widest font-mono">
              <Ban className="w-3.5 h-3.5" /> Deshabilitadas
            </div>
            <div className="text-2xl font-semibold">{disabledIfaces.length}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-muted-foreground text-xs uppercase tracking-widest font-mono">Total</div>
            <div className="text-2xl font-semibold">{interfaces.length}</div>
          </div>
        </div>

        {/* Down alert */}
        {downIfaces.length > 0 && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2" data-testid="mk-alert-down">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-red-500">
                {downIfaces.length} {downIfaces.length === 1 ? "interfaz caída" : "interfaces caídas"}
              </div>
              <div className="text-xs text-red-400/90 mt-1 font-mono break-all">
                {downIfaces.map((i) => i.name).join(", ")}
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500" data-testid="mk-sync-error">
            {error}
          </div>
        )}

        {/* Interfaces table */}
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead className="text-right"><ArrowDownToLine className="w-3.5 h-3.5 inline" /> RX</TableHead>
                <TableHead className="text-right"><ArrowUpFromLine className="w-3.5 h-3.5 inline" /> TX</TableHead>
                <TableHead>Comentario</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !state && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Cargando…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    {interfaces.length === 0
                      ? "Sin datos aún. Presiona 'Sincronizar ahora' para consultar el router."
                      : "Nada coincide con la búsqueda."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((i) => {
                const isDown = i.running === false && i.disabled !== true;
                const isDisabled = i.disabled === true;
                return (
                  <TableRow
                    key={i.name}
                    className={isDown ? "bg-red-500/5" : ""}
                    data-testid={`mk-if-row-${i.name}`}
                  >
                    <TableCell className="font-mono text-sm">{i.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{i.type || "—"}</Badge></TableCell>
                    <TableCell>
                      {isDisabled ? (
                        <Badge className="bg-muted text-muted-foreground border-border" data-testid={`mk-if-status-${i.name}`}>
                          <Ban className="w-3 h-3 mr-1" /> deshabilitada
                        </Badge>
                      ) : isDown ? (
                        <Badge className="bg-red-500/20 text-red-500 border-red-500/40" data-testid={`mk-if-status-${i.name}`}>
                          <WifiOff className="w-3 h-3 mr-1" /> caída
                        </Badge>
                      ) : i.running === true ? (
                        <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40" data-testid={`mk-if-status-${i.name}`}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> activa
                        </Badge>
                      ) : (
                        <Badge variant="outline" data-testid={`mk-if-status-${i.name}`}>—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{i.mac_address || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{humanBytes(i.rx_byte)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{humanBytes(i.tx_byte)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={i.comment}>
                      {i.comment || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
