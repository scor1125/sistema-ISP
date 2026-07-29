import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Server, Router as RouterIcon, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Header widget that lists registered network servers (Mikrotik + OLT).
 * Availability is derived from the presence of a device record — real SNMP/API
 * probing will replace this once the OLT/Mikrotik integrations are wired.
 */
export default function ServersStatus() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/devices");
      setDevices(data);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh every 30 seconds so newly registered devices appear without reload.
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const { mikrotiks, olts } = useMemo(
    () => ({
      mikrotiks: devices.filter((d) => d.kind === "mikrotik"),
      olts: devices.filter((d) => d.kind === "olt"),
    }),
    [devices],
  );

  const total = mikrotiks.length + olts.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="servers-status-trigger"
          className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-card hover:bg-accent transition-colors"
        >
          <span className="relative flex h-2 w-2">
            {total > 0 && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${total > 0 ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          </span>
          <span className="text-xs font-medium">
            {loading ? "…" : total > 0 ? `${total} en línea` : "Sin servidores"}
          </span>
          <Server className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" data-testid="servers-status-panel">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
            Estado de red
          </div>
          <div className="mt-1 text-sm font-medium">
            {mikrotiks.length} Mikrotik · {olts.length} OLT
          </div>
        </div>

        <DeviceGroup title="Mikrotik" icon={RouterIcon} devices={mikrotiks} />
        <DeviceGroup title="OLT" icon={Radio} devices={olts} />

        {total === 0 && (
          <div className="p-4 text-xs text-muted-foreground">
            Aún no tienes servidores. Registra tus routers Mikrotik y OLTs desde los paneles correspondientes.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DeviceGroup({ title, icon: Icon, devices }) {
  if (devices.length === 0) return null;
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-2">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {devices.map((d) => (
          <li key={d.id} className="px-4 py-2 flex items-center gap-2 hover:bg-accent transition-colors">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{d.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {d.host}{d.port ? `:${d.port}` : ""} · {d.location || "—"}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase font-mono">
              {d.connection === "vpn" ? "VPN" : "IP pública"}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
