import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Globe, ArrowDown, ArrowUp, AlertTriangle } from "lucide-react";

const AXIS = "hsl(240 5% 55%)";
const GRID = "hsl(240 10% 15%)";
const RX = "hsl(210 100% 55%)";
const TX = "hsl(160 84% 42%)";
const TT = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

const POLL_MS = 4000;
const POINTS = 30; // ~2 min de historia visible

/**
 * Consumo de internet en vivo de cada Mikrotik: mide sus interfaces WAN
 * (las marcadas en Mikrotik → Interfaces) directo con `monitor-traffic`.
 *
 * La historia se arma en el navegador — el router solo sabe decir cuánto
 * pasa *ahora*, así que cada muestra se va acumulando mientras el panel
 * esté abierto.
 */
export default function WanTrafficCard() {
  const [routers, setRouters] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const seriesRef = useRef({});   // id -> [{t, rx, tx}]
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await api.get("/mikrotik/wan-traffic");
        if (cancelled) return;
        const t = new Date().toLocaleTimeString().slice(0, 8);
        const next = { ...seriesRef.current };
        data.routers.forEach((r) => {
          if (!r.ok) return;
          const prev = next[r.id] || [];
          next[r.id] = [...prev.slice(-(POINTS - 1)), { t, rx: r.rx_mbps, tx: r.tx_mbps }];
        });
        seriesRef.current = next;
        setRouters(data.routers);
      } catch (e) {
        console.error("[WanTraffic] poll failed:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    tick();
    timerRef.current = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, []);

  // Sin routers registrados no tiene sentido ocupar espacio en el panel.
  if (loaded && routers.length === 0) return null;

  return (
    <section className="mt-6 rounded-md border border-border bg-card p-5">
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <Globe className="w-4 h-4 text-primary" />
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
          Consumo de internet en vivo · WAN
        </div>
        <div className="ml-auto text-[11px] text-muted-foreground font-mono flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          cada {POLL_MS / 1000}s
        </div>
      </div>

      {!loaded ? (
        <div className="text-sm text-muted-foreground">Midiendo…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {routers.map((r) => (
            <RouterChart key={r.id} router={r} series={seriesRef.current[r.id] || []} />
          ))}
        </div>
      )}
    </section>
  );
}

function RouterChart({ router: r, series }) {
  const last = series[series.length - 1];

  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="text-sm font-medium truncate">{r.name}</div>
        {r.ok ? (
          <>
            <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-400 font-mono">
              <ArrowDown className="w-2.5 h-2.5 mr-1" /> {last?.rx ?? r.rx_mbps} Mbps
            </Badge>
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500 font-mono">
              <ArrowUp className="w-2.5 h-2.5 mr-1" /> {last?.tx ?? r.tx_mbps} Mbps
            </Badge>
            <div className="ml-auto text-[10px] text-muted-foreground font-mono truncate max-w-[45%]">
              {r.wan_interfaces.join(", ")}
            </div>
          </>
        ) : (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
            <AlertTriangle className="w-2.5 h-2.5 mr-1" /> sin datos
          </Badge>
        )}
      </div>

      {r.ok ? (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id={`rx-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={RX} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={RX} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`tx-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TX} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={TX} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="t" stroke={AXIS} fontSize={9} minTickGap={40} />
              <YAxis stroke={AXIS} fontSize={9} width={40} unit="M" />
              <Tooltip contentStyle={TT} formatter={(v, n) => [`${v} Mbps`, n === "rx" ? "Bajada" : "Subida"]} />
              <Area type="monotone" dataKey="rx" name="rx" stroke={RX} strokeWidth={2}
                fill={`url(#rx-${r.id})`} isAnimationActive={false} />
              <Area type="monotone" dataKey="tx" name="tx" stroke={TX} strokeWidth={2}
                fill={`url(#tx-${r.id})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center text-center text-xs text-muted-foreground px-4">
          {r.reason}
        </div>
      )}
    </div>
  );
}
