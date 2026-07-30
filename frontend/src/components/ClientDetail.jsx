import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Wifi, WifiOff, Gauge, Activity, MessageCircle, DollarSign, Router } from "lucide-react";
import { useNavigate } from "react-router-dom";

const AXIS = "hsl(240 5% 55%)";
const GRID = "hsl(240 10% 15%)";
const RX = "hsl(210 100% 55%)";
const TX = "hsl(160 84% 42%)";
const TOOLTIP = { background: "hsl(240 10% 8%)", border: "1px solid hsl(240 10% 15%)", borderRadius: 6 };

/**
 * Real-time traffic drawer for a client.
 *
 * Traffic values come from /api/onus (mocked deterministic per-client). We
 * poll every 2.5s and add a small ±15% jitter locally so the chart looks
 * live. When the OLT/Mikrotik integrations land, replace the polling source
 * without touching the UI.
 */
export default function ClientDetail({ client, open, onOpenChange }) {
  const [series, setSeries] = useState([]);
  const [current, setCurrent] = useState(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !client?.id) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await api.get("/onus");
        const onu = data.find((o) => o.client_id === client.id);
        if (!onu || cancelled) return;
        // Add ±15% jitter for a lifelike waveform
        const jitter = (v) => Math.max(0, +(v * (0.85 + Math.random() * 0.30)).toFixed(2));
        const point = {
          t: new Date().toLocaleTimeString().slice(0, 8),
          rx: jitter(onu.rx_mbps),
          tx: jitter(onu.tx_mbps),
          power: onu.power_dbm,
          ip: onu.ip_address,
          serial: onu.onu_serial,
          server: onu.mikrotik_server,
        };
        setCurrent(point);
        setSeries((s) => [...s.slice(-30), point]);
      } catch (e) {
        console.error("traffic poll failed", e);
      }
    };

    setSeries([]);
    tick();
    timerRef.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [open, client?.id]);

  const powerTone = useMemo(() => {
    const p = current?.power;
    if (p == null) return "text-muted-foreground";
    if (p > -8 || p < -27) return "text-red-400";
    if (p > -12 || p < -25) return "text-amber-400";
    return "text-emerald-400";
  }, [current]);

  if (!client) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            {client.full_name}
          </SheetTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono flex-wrap">
            <Badge variant="outline">{client.community || "Sin comunidad"}</Badge>
            {client.tag && <Badge variant="outline" className="border-primary/40 text-primary">{client.tag}</Badge>}
            {client.status && <Badge variant="outline">{client.status}</Badge>}
          </div>
        </SheetHeader>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Kpi icon={Wifi} label="RX ahora" value={current ? `${current.rx} Mbps` : "…"} tone="info" />
          <Kpi icon={Wifi} label="TX ahora" value={current ? `${current.tx} Mbps` : "…"} tone="success" />
          <Kpi icon={Gauge} label="Potencia ONU" value={current?.power != null ? `${current.power} dBm` : "…"} toneCls={powerTone} />
          <Kpi icon={Router} label="Servidor" value={current?.server || client.mikrotik_server || "—"} />
        </div>

        {/* Chart */}
        <div className="mt-4 rounded-md border border-border bg-card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Tráfico en vivo</div>
            <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              actualizando cada 2.5s
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="t" stroke={AXIS} fontSize={10} />
                <YAxis stroke={AXIS} fontSize={10} />
                <Tooltip contentStyle={TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="rx" name="RX ↓" stroke={RX} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="tx" name="TX ↑" stroke={TX} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Facts */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="IP" value={<span className="font-mono">{current?.ip || client.ip_address || "—"}</span>} />
          <Row label="Serial ONU" value={<span className="font-mono">{current?.serial || "—"}</span>} />
          <Row label="Teléfono" value={<span className="font-mono">{client.phone || "—"}</span>} />
          <Row label="Comunidad" value={client.community || "—"} />
          <Row label="Día de pago" value={`Día ${client.payment_day}`} />
          <Row label="Próximo vencimiento" value={<span className="font-mono">{client.next_due_date?.slice(0,10) || "—"}</span>} />
          <Row label="Nombre WiFi" value={<span className="font-mono">{client.wifi_ssid || "—"}</span>} />
          <Row label="Contraseña WiFi" value={<span className="font-mono">{client.wifi_password || "—"}</span>} />
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => navigate(`/pagos?client=${client.id}`)}>
            <DollarSign className="w-4 h-4 mr-1" /> Registrar pago
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/whatsapp?client=${client.id}`)}>
            <MessageCircle className="w-4 h-4 mr-1" /> Abrir WhatsApp
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Kpi({ icon: Icon, label, value, tone, toneCls }) {
  const toneClass = toneCls || {
    info: "text-sky-400",
    success: "text-emerald-400",
    warn: "text-amber-400",
    danger: "text-red-400",
  }[tone] || "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`mt-1 font-display text-lg font-bold tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <>
      <div className="text-xs text-muted-foreground uppercase tracking-widest font-mono">{label}</div>
      <div>{value}</div>
    </>
  );
}
