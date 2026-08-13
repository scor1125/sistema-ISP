import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 pb-5 border-b border-border/60">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.28em] text-primary/80 font-mono mb-1.5">Módulo</div>
        <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
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
    <div
      data-testid={testId}
      className="relative rounded-xl border border-border/60 bg-card p-5 sm:p-6 hover:-translate-y-0.5 hover:border-primary/40 transition-all duration-300 overflow-hidden group"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary/60 transition-colors" />
      <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground/80 font-mono">{label}</div>
      <div className={`mt-3 font-heading text-3xl sm:text-4xl tracking-tight ${tones[tone]}`}>{value}</div>
      {trend && <div className="mt-2 text-xs text-muted-foreground/90">{trend}</div>}
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
