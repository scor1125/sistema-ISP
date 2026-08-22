import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, FilePlus2, FilePen, FileX2 } from "lucide-react";

const PENDING_OPS = {
  create: { label: "Alta sin confirmar",    cls: "border-emerald-500/40 text-emerald-500", Icon: FilePlus2 },
  update: { label: "Edición sin confirmar", cls: "border-sky-500/40 text-sky-400",         Icon: FilePen },
  delete: { label: "Baja sin confirmar",    cls: "border-red-500/40 text-red-500",         Icon: FileX2 },
};

/**
 * Marca un registro que se capturó pero todavía no se confirma desde
 * "Aplicar Cambios" — mientras tenga esta etiqueta no cuenta como definitivo
 * y no se ha aplicado en el Mikrotik.
 */
export function PendingBadge({ row }) {
  const op = row?._pending?.op;
  if (!op) return null;
  const s = PENDING_OPS[op] || PENDING_OPS.update;
  const { Icon } = s;
  return (
    <Badge variant="outline" className={`text-[9px] ${s.cls}`} title={s.label}>
      <Icon className="w-2.5 h-2.5 mr-1" /> {s.label}
    </Badge>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4 pb-3 border-b border-border/50">
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-[0.24em] text-primary/70 font-mono mb-1">Módulo</div>
        <h1 className="font-heading text-xl sm:text-2xl leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">{subtitle}</p>}
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
      className="relative rounded-lg border border-border/50 bg-card p-3 sm:p-4 hover:border-primary/40 transition-colors duration-200 overflow-hidden group"
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/0 group-hover:bg-primary/60 transition-colors" />
      <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80 font-mono">{label}</div>
      <div className={`mt-1.5 font-heading text-xl sm:text-2xl tracking-tight ${tones[tone]}`}>{value}</div>
      {trend && <div className="mt-1 text-[11px] text-muted-foreground/80">{trend}</div>}
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
