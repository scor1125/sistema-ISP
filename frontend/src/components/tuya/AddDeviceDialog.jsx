import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Copy, CheckCircle2, AlertTriangle, QrCode, Search, Wifi, WifiOff,
  Smartphone, Info, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export default function AddDeviceDialog({ open, onOpenChange, onAdded }) {
  // Tab: by-id | pairing-token
  const [tab, setTab] = useState("by-id");

  // --- By ID ---
  const [deviceId, setDeviceId] = useState("");
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState(null);
  const [byIdError, setByIdError] = useState(null);

  // --- Pairing token ---
  const [tokenLoading, setTokenLoading] = useState(false);
  const [token, setToken] = useState(null);

  const reset = () => {
    setDeviceId(""); setFound(null); setByIdError(null);
    setToken(null); setTab("by-id");
  };

  const validateById = async () => {
    const did = deviceId.trim();
    if (!did) return toast.error("Ingresa un device_id");
    setChecking(true); setByIdError(null); setFound(null);
    try {
      const { data } = await api.post("/tuya/devices/add", { device_id: did });
      setFound(data);
      toast.success("Dispositivo encontrado en tu Tuya Cloud Project");
    } catch (e) {
      setByIdError(formatApiError(e));
    } finally { setChecking(false); }
  };

  const finishAdd = () => {
    onAdded?.();
    reset();
    onOpenChange(false);
    toast.success("Refrescando lista de dispositivos…");
  };

  const generateToken = async () => {
    setTokenLoading(true); setToken(null);
    try {
      const { data } = await api.post("/tuya/pairing-token", {});
      setToken(data);
      toast.success("Token generado · válido 10 min");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setTokenLoading(false); }
  };

  const copyToken = async () => {
    if (!token?.token) return;
    try {
      await navigator.clipboard.writeText(token.token);
      toast.success("Token copiado");
    } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="tuya-add-device-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" /> Añadir dispositivo Tuya
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="by-id" className="flex-1" data-testid="tuya-add-tab-byid">
              <Search className="w-3.5 h-3.5 mr-1" /> Por Device ID
            </TabsTrigger>
            <TabsTrigger value="pairing" className="flex-1" data-testid="tuya-add-tab-pairing">
              <QrCode className="w-3.5 h-3.5 mr-1" /> Pairing en Smart Life
            </TabsTrigger>
          </TabsList>

          {/* ---- By ID Tab ---- */}
          <TabsContent value="by-id" className="space-y-3 pt-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
              <span>
                Usa este flujo cuando ya tengas el <span className="font-mono text-foreground">device_id</span> desde
                <a href="https://iot.tuya.com/cloud/products/protocol" target="_blank" rel="noreferrer" className="text-primary underline mx-1">iot.tuya.com → Cloud → Development → tu Proyecto → Devices</a>.
                Solo valida que el dispositivo pertenezca a tu proyecto y aparecerá al refrescar.
              </span>
            </div>

            <div>
              <Label className="text-xs">Device ID de Tuya</Label>
              <Input
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="ej: bf59e12f8f5a1c0b2c8gzp"
                className="font-mono"
                data-testid="tuya-add-device-id"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={validateById} disabled={checking || !deviceId.trim()} data-testid="tuya-add-validate">
                <Search className={`w-4 h-4 mr-1 ${checking ? "animate-pulse" : ""}`} />
                {checking ? "Validando…" : "Validar en Tuya"}
              </Button>
            </div>

            {byIdError && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500" data-testid="tuya-add-error">
                <AlertTriangle className="w-4 h-4 inline mr-1" /> {byIdError}
              </div>
            )}

            {found && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2" data-testid="tuya-add-found">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <div className="font-medium">{found.name}</div>
                  {found.online ? (
                    <Badge variant="outline" className="ml-auto text-[10px] border-emerald-500/40 text-emerald-500">
                      <Wifi className="w-3 h-3 mr-1" /> online
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
                      <WifiOff className="w-3 h-3 mr-1" /> offline
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {found.device_id}
                </div>
                <div className="text-xs text-muted-foreground">
                  {found.product_name || found.category || "dispositivo"}
                </div>
                <Button onClick={finishAdd} size="sm" className="w-full mt-2" data-testid="tuya-add-refresh">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Añadir a la lista y refrescar
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ---- Pairing Tab ---- */}
          <TabsContent value="pairing" className="space-y-3 pt-3">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
              <span>
                Genera un token temporal (10 min). Después:
                <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                  <li>Abre la app <span className="font-medium text-foreground">Smart Life</span> en tu teléfono</li>
                  <li>Ícono <span className="font-medium text-foreground">"+"</span> → <span className="font-medium text-foreground">Escanear</span> o <span className="font-medium text-foreground">Añadir dispositivo</span></li>
                  <li>Ingresa el token generado abajo o escanéalo</li>
                  <li>Sigue el pairing normal (Wi-Fi, BLE, etc.)</li>
                  <li>El dispositivo quedará vinculado a este Cloud Project</li>
                </ol>
              </span>
            </div>

            <Button
              onClick={generateToken}
              disabled={tokenLoading}
              className="w-full"
              data-testid="tuya-add-pairing-btn"
            >
              <QrCode className={`w-4 h-4 mr-1 ${tokenLoading ? "animate-pulse" : ""}`} />
              {tokenLoading ? "Generando…" : (token ? "Generar otro token" : "Generar token de pairing")}
            </Button>

            {token && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2" data-testid="tuya-add-token">
                <div className="text-[10px] uppercase tracking-widest text-primary font-mono">Token de pairing</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg tracking-wider break-all bg-background rounded px-2 py-1.5 border border-border" data-testid="tuya-add-token-value">
                    {token.token}
                  </code>
                  <Button size="icon" variant="outline" onClick={copyToken} data-testid="tuya-add-token-copy">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Válido {token.expire_time ? `${Math.round(token.expire_time / 60)} min` : "10 min"} · región {(token.region || "").toUpperCase() || "US"}</span>
                </div>
                <Button variant="outline" size="sm" onClick={finishAdd} className="w-full mt-1" data-testid="tuya-add-done">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Ya vinculé el dispositivo · Refrescar
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
