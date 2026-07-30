import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 pb-4 border-b border-border">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Módulo</div>
        <h1 className="font-display text-3xl font-bold tracking-tight mt-1">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-xl">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function Kpi({ label, value, trend, testId, tone = "default" }) {
  const tones = {
    default: "text-foreground",
    success: "text-emerald-400",
    danger: "text-red-400",
    warn: "text-amber-400",
    info: "text-sky-400",
  };
  return (
    <div data-testid={testId} className="rounded-md border border-border bg-card p-5 hover:-translate-y-0.5 transition-transform">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className={`mt-2 font-display text-3xl font-bold tracking-tight ${tones[tone]}`}>{value}</div>
      {trend && <div className="mt-1 text-xs text-muted-foreground">{trend}</div>}
    </div>
  );
}

export function EmptyRow({ colSpan, text = "Sin registros." }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-muted-foreground py-8 text-sm">{text}</td>
    </tr>
  );
}

export function SearchBar({ value, onChange, placeholder = "Buscar…", right = null, hint = null, testId = "search-input" }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9 pr-9" placeholder={placeholder} value={value}
          onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        {value && (
          <button type="button" onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent text-muted-foreground"
            data-testid={`${testId}-clear`}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {hint && <span className="text-xs text-muted-foreground font-mono">{hint}</span>}
      {right}
    </div>
  );
}

/** Utility: normalize accent + lowercase for search matching. */
export function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
