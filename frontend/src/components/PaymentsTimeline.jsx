import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  DollarSign, Wallet, ArrowLeftRight, CreditCard, HelpCircle,
  ChevronLeft, ChevronRight, Search, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

const AXIS = "hsl(240 5% 55%)";
const GRID = "hsl(240 10% 15%)";
const TT = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

const MODES = [
  { value: "today",  label: "Hoy" },
  { value: "day",    label: "Día" },
  { value: "month",  label: "Mes" },
  { value: "year",   label: "Año" },
];

const METHODS = [
  { value: "cash",     label: "Efectivo",      icon: Wallet,        tone: "text-emerald-500", ring: "border-emerald-500/40 bg-emerald-500/10" },
  { value: "transfer", label: "Transferencia", icon: ArrowLeftRight, tone: "text-sky-500",     ring: "border-sky-500/40 bg-sky-500/10" },
  { value: "stripe",   label: "Tarjeta",       icon: CreditCard,    tone: "text-violet-500",  ring: "border-violet-500/40 bg-violet-500/10" },
  { value: "other",    label: "Otro",          icon: HelpCircle,    tone: "text-muted-foreground", ring: "border-muted-foreground/40 bg-muted/30" },
];

const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));

const MXN = (n) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStr = () => {
  const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const yearStr = () => String(new Date().getFullYear());

/** Given a payment.created_at and the active mode, return {start,end} bounds
    and grouping key (hour/day/month) for aggregation. */
function computeBucket(mode, value, iso) {
  const dt = new Date(iso);
  if (mode === "today" || mode === "day") {
    return `${pad(dt.getHours())}:00`; // hour bucket
  }
  if (mode === "month") {
    return `${pad(dt.getDate())}`; // day-of-month bucket
  }
  if (mode === "year") {
    return `${pad(dt.getMonth() + 1)}`; // month bucket
  }
  return "?";
}

/** True if payment falls in the selected range. `value` is `YYYY-MM-DD` for
    day, `YYYY-MM` for month, `YYYY` for year, `today` mode ignores value. */
function inRange(mode, value, iso) {
  const s = String(iso || "");
  if (!s) return false;
  if (mode === "today") return s.slice(0, 10) === todayStr();
  if (mode === "day")   return s.slice(0, 10) === value;
  if (mode === "month") return s.slice(0, 7) === value;
  if (mode === "year")  return s.slice(0, 4) === value;
  return true;
}

/** Build the ordered list of bucket keys for the X-axis so gaps show zero. */
function bucketAxis(mode, value) {
  if (mode === "today" || mode === "day") {
    return Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);
  }
  if (mode === "month") {
    // days-in-month based on selected value (YYYY-MM)
    const [y, m] = (value || monthStr()).split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    return Array.from({ length: days }, (_, i) => pad(i + 1));
  }
  if (mode === "year") {
    return Array.from({ length: 12 }, (_, i) => pad(i + 1));
  }
  return [];
}

function bucketLabel(mode, key) {
  if (mode === "year") {
    const idx = Number(key) - 1;
    return ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][idx] || key;
  }
  return key;
}

function shiftValue(mode, value, delta) {
  if (mode === "day") {
    const d = new Date(value + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (mode === "month") {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  if (mode === "year") return String(Number(value) + delta);
  return value;
}

function rangeLabel(mode, value) {
  if (mode === "today") return "Hoy · " + todayStr();
  if (mode === "day")   return value;
  if (mode === "month") return value;
  if (mode === "year")  return value;
  return value;
}

export default function PaymentsTimeline() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("today");
  const [value, setValue] = useState(todayStr());
  const [methodFilter, setMethodFilter] = useState("all"); // one of "all" | method values
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/payments");
        // Ignore promesas so revenue view stays focused on real payments
        setPayments(Array.isArray(data) ? data.filter((p) => !p.is_promise) : []);
      } catch (e) { toast.error(formatApiError(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  // Reset default value whenever mode changes
  useEffect(() => {
    if (mode === "today") setValue(todayStr());
    else if (mode === "day") setValue(todayStr());
    else if (mode === "month") setValue(monthStr());
    else if (mode === "year") setValue(yearStr());
  }, [mode]);

  const inRangeAll = useMemo(
    () => payments.filter((p) => inRange(mode, value, p.created_at)),
    [payments, mode, value]
  );

  // Method breakdown across the range (unfiltered by methodFilter, so chips
  // can show live subtotals even when a chip is selected)
  const byMethod = useMemo(() => {
    const m = { cash: 0, transfer: 0, stripe: 0, other: 0 };
    const c = { cash: 0, transfer: 0, stripe: 0, other: 0 };
    for (const p of inRangeAll) {
      const key = m[p.method] !== undefined ? p.method : "other";
      m[key] += Number(p.amount || 0);
      c[key] += 1;
    }
    return { amounts: m, counts: c };
  }, [inRangeAll]);

  const totalRange = useMemo(
    () => Object.values(byMethod.amounts).reduce((a, b) => a + b, 0),
    [byMethod]
  );
  const countRange = useMemo(
    () => Object.values(byMethod.counts).reduce((a, b) => a + b, 0),
    [byMethod]
  );

  // Apply chip + query filter for the table
  const tableRows = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return inRangeAll.filter((p) => {
      if (methodFilter !== "all" && p.method !== methodFilter) return false;
      if (!nq) return true;
      return `${p.client_name || ""} ${p.concept || ""} ${p.notes || ""} ${p.invoice_number || ""}`
        .toLowerCase().includes(nq);
    }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [inRangeAll, methodFilter, q]);

  // Chart data — buckets follow the mode; respect chip filter
  const chartData = useMemo(() => {
    const axis = bucketAxis(mode, value);
    const idx = Object.fromEntries(axis.map((k) => [k, 0]));
    const src = methodFilter === "all"
      ? inRangeAll
      : inRangeAll.filter((p) => p.method === methodFilter);
    for (const p of src) {
      const key = computeBucket(mode, value, p.created_at);
      if (idx[key] !== undefined) idx[key] += Number(p.amount || 0);
    }
    return axis.map((k) => ({ bucket: bucketLabel(mode, k), amount: +idx[k].toFixed(2) }));
  }, [inRangeAll, mode, value, methodFilter]);

  const activeMethodColor = useMemo(() => {
    if (methodFilter === "all") return "hsl(var(--primary))";
    const map = {
      cash: "hsl(160 84% 42%)",
      transfer: "hsl(210 100% 55%)",
      stripe: "hsl(270 90% 60%)",
      other: "hsl(240 5% 55%)",
    };
    return map[methodFilter] || "hsl(var(--primary))";
  }, [methodFilter]);

  return (
    <section className="mt-6 rounded-md border border-border bg-card overflow-hidden">
      {/* Top bar: title + mode selector + navigation */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4 h-4 text-primary" />
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Ingresos por período</div>

        <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`px-2.5 py-1 text-[11px] uppercase tracking-widest font-mono rounded ${
                mode === m.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`payments-mode-${m.value}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode !== "today" && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => setValue((v) => shiftValue(mode, v, -1))}
              data-testid="payments-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={mode === "day" ? "date" : "text"}
              className="h-8 w-[130px] font-mono text-xs"
              data-testid="payments-value"
              placeholder={mode === "month" ? "YYYY-MM" : mode === "year" ? "YYYY" : ""}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => setValue((v) => shiftValue(mode, v, +1))}
              data-testid="payments-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Header stats: BIG total + range label + method chips */}
      <div className="p-4 border-b border-border grid grid-cols-1 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2 rounded-md border border-primary/40 bg-primary/5 p-3 sm:p-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 font-mono flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Total · {rangeLabel(mode, value)}
          </div>
          <div className="mt-1 font-heading text-3xl sm:text-4xl tracking-tight text-primary"
            data-testid="payments-total">
            {loading ? "…" : MXN(totalRange)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 font-mono">
            {countRange} {countRange === 1 ? "pago" : "pagos"} · sumado automáticamente
          </div>
        </div>

        {METHODS.map((m) => {
          const active = methodFilter === m.value;
          const Icon = m.icon;
          return (
            <button
              key={m.value}
              onClick={() => setMethodFilter((cur) => (cur === m.value ? "all" : m.value))}
              className={`rounded-md border p-3 text-left transition-colors ${
                active ? m.ring : "border-border bg-card hover:border-primary/30"
              }`}
              data-testid={`payments-method-${m.value}`}
            >
              <div className={`text-[10px] uppercase tracking-[0.22em] font-mono flex items-center gap-1 ${m.tone}`}>
                <Icon className="w-3 h-3" /> {m.label}
              </div>
              <div className="font-mono text-lg mt-1 font-semibold">
                {MXN(byMethod.amounts[m.value] || 0)}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {byMethod.counts[m.value] || 0} {byMethod.counts[m.value] === 1 ? "pago" : "pagos"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="p-4 border-b border-border">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
            {mode === "today" || mode === "day" ? "Por hora"
              : mode === "month" ? "Por día"
              : "Por mes"}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {methodFilter === "all" ? "todos los métodos" : `filtro: ${METHOD_LABEL[methodFilter]}`}
          </div>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="bucket" stroke={AXIS} fontSize={10}
                interval={mode === "today" || mode === "day" ? 2 : 0} />
              <YAxis stroke={AXIS} fontSize={10} />
              <Tooltip contentStyle={TT} formatter={(v) => MXN(v)} />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={activeMethodColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Search + table */}
      <div className="p-3 border-b border-border">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por cliente, concepto o folio…"
            className="pl-9 h-8"
            data-testid="payments-search"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Registrado por</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Cargando…</TableCell></TableRow>
            )}
            {!loading && tableRows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                Sin pagos en {rangeLabel(mode, value)}{methodFilter !== "all" ? ` · ${METHOD_LABEL[methodFilter]}` : ""}.
              </TableCell></TableRow>
            )}
            {tableRows.map((p) => (
              <TableRow key={p.id} data-testid={`payments-row-${p.id}`}>
                <TableCell className="font-mono text-xs">{(p.created_at || "").slice(0, 10)}</TableCell>
                <TableCell className="font-mono text-xs">{(p.created_at || "").slice(11, 16)}</TableCell>
                <TableCell>{p.client_name || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.concept || "Mensualidad"}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] uppercase">{METHOD_LABEL[p.method] || p.method}</Badge></TableCell>
                <TableCell className="text-right font-mono font-semibold">{MXN(p.amount)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.created_by_name || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
