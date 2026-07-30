import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, EmptyRow, Kpi, SearchBar, norm } from "@/components/Common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Radio, AlertTriangle } from "lucide-react";

export default function OLT() {
  const [onus, setOnus] = useState([]);
  const [devices, setDevices] = useState([]);
  const [config, setConfig] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, d, c] = await Promise.all([
        api.get("/onus"),
        api.get("/devices"),
        api.get("/config"),
      ]);
      setOnus(o.data);
      setDevices(d.data.filter(x => x.kind === "olt"));
      setConfig(c.data);
    } catch (e) {
      console.error("OLT load failed", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const high = config?.onu_power_high_threshold ?? -8;
  const low = config?.onu_power_low_threshold ?? -27;

  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return onus;
    return onus.filter((o) => norm(`${o.full_name} ${o.onu_serial} ${o.ip_address} ${o.mikrotik_server}`).includes(nq));
  }, [onus, q]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => a.power_dbm - b.power_dbm), [filtered]);
  const critical = useMemo(
    () => sorted.filter(o => o.power_dbm > high || o.power_dbm < low).length,
    [sorted, high, low],
  );
  const avg = useMemo(
    () => (onus.length ? (onus.reduce((a, b) => a + b.power_dbm, 0) / onus.length).toFixed(2) : "—"),
    [onus],
  );

  return (
    <div>
      <PageHeader title="OLT / ONUs" subtitle={`Potencias en dBm. Umbral alto: ${high}, umbral bajo: ${low}. (Datos simulados — vincula tu OLT vía VPN o IP pública)`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi label="ONUs monitoreadas" value={onus.length} testId="kpi-onus" />
        <Kpi label="Potencia promedio" value={`${avg} dBm`} tone="info" />
        <Kpi label="Fuera de umbral" value={critical} tone="danger" trend={<span className="inline-flex gap-1"><AlertTriangle className="w-3 h-3" /> Requieren revisión</span>} />
        <Kpi label="OLTs conectados" value={devices.length} tone="success" trend={<span className="inline-flex gap-1"><Radio className="w-3 h-3" /> Registradas</span>} />
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Buscar por cliente, serial ONU, IP o servidor…"
        hint={`${sorted.length} / ${onus.length}`} testId="olt-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>ONU serial</TableHead>
            <TableHead>Potencia</TableHead><TableHead>RX/TX</TableHead>
            <TableHead>IP</TableHead><TableHead>Servidor</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {onus.length === 0 && <EmptyRow colSpan={7} text="Sin ONUs. Crea clientes con serial ONU para verlos aquí." />}
            {sorted.map(o => {
              const bad = o.power_dbm > high || o.power_dbm < low;
              return (
                <TableRow key={o.client_id}>
                  <TableCell className="font-medium">{o.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{o.onu_serial}</TableCell>
                  <TableCell className="font-mono">
                    <span className={bad ? "text-red-400" : "text-emerald-400"}>{o.power_dbm} dBm</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.rx_mbps}↓ / {o.tx_mbps}↑</TableCell>
                  <TableCell className="font-mono text-xs">{o.ip_address}</TableCell>
                  <TableCell>{o.mikrotik_server}</TableCell>
                  <TableCell><Badge variant="outline" className={bad ? "border-red-500/30 text-red-400 bg-red-500/10" : "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"}>{bad ? "Fuera de umbral" : "OK"}</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
