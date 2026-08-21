import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { ChevronDown, X, Search, Wifi, AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Reusable form dialog. `fields`: [{name,label,type,options?,placeholder?,required?,hint?,suggestions?}]
 * type: text | number | textarea | select
 */
export function FormDialog({ trigger, title, fields, initial, onSubmit, submitLabel = "Guardar", open, onOpenChange, size = "lg" }) {
  const [values, setValues] = useState(initial || {});
  const [loading, setLoading] = useState(false);

  // Reset internal state whenever the dialog is (re)opened with a new
  // `initial` object — critical for edit dialogs so the fields prefill with
  // the record being edited instead of the previous one.
  useEffect(() => {
    if (open) setValues(initial || {});
  }, [open, initial]);

  const isOpen = open !== undefined ? open : undefined;

  const handleChange = (name, v) => setValues((s) => ({ ...s, [name]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(values);
      if (onOpenChange) onOpenChange(false);
      setValues(initial || {});
    } finally {
      setLoading(false);
    }
  };

  const sizeCls = {
    lg: "max-w-lg",
    xl: "max-w-2xl",
    "2xl": "max-w-3xl",
    "3xl": "max-w-4xl",
    "4xl": "max-w-5xl",
    "5xl": "max-w-6xl",
    full: "max-w-[95vw] w-[95vw] h-[92vh] max-h-[92vh]",
  }[size] || "max-w-lg";

  const heightCls = size === "full" ? "" : "max-h-[90vh]";

  const gridCls = size === "full"
    ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    : "grid grid-cols-2 gap-4";

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={`${sizeCls} ${heightCls} flex flex-col p-0 gap-0`}>
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className={gridCls}>
              {fields.map((f) => (
                <Field key={f.name} field={f} value={values[f.name] ?? ""} onChange={handleChange} values={values} />
              ))}
            </div>
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border bg-card/50">
            <Button type="submit" disabled={loading} data-testid="form-submit">
              {loading ? "Guardando…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ field, value, onChange, values }) {
  const key = `field-${field.name}`;
  // In full-width dialogs, the parent grid supplies the column count;
  // full-span fields still span all columns via `full: true`.
  const wrapCls = field.full ? "col-span-full" : "";
  // `hint` can depend on other fields (e.g. which router is selected), same
  // pattern as `options: (values) => [...]` above.
  const hint = typeof field.hint === "function" ? field.hint(values) : field.hint;

  return (
    <div className={wrapCls}>
      <Label htmlFor={key}>{field.label}</Label>
      <FieldControl field={field} value={value} onChange={onChange} inputId={key} values={values} />
      {hint && (
        <div className="mt-1 text-[11px] text-muted-foreground font-mono">{hint}</div>
      )}
    </div>
  );
}

function SyncableSelectRow({ field, values, select }) {
  const [syncing, setSyncing] = useState(false);
  const disabled = field.syncDisabled ? field.syncDisabled(values) : false;

  const run = async () => {
    setSyncing(true);
    try {
      await field.onSync(values);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0">{select}</div>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={run}
        disabled={syncing || disabled}
        title={field.syncTitle || "Sincronizar"}
        data-testid={`sync-${field.name}`}
      >
        <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}

function FieldControl({ field, value, onChange, inputId, values }) {
  const testId = `input-${field.name}`;

  if (field.type === "textarea") {
    return (
      <Textarea
        id={inputId}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(field.name, e.target.value)}
        placeholder={field.placeholder}
      />
    );
  }

  if (field.type === "select") {
    // Options can be a static array OR a `(values) => array` callback so a
    // field can depend on another field (e.g. `mikrotik_interface` reads the
    // current `mikrotik_server`).
    const rawOpts = typeof field.options === "function" ? field.options(values) : (field.options || []);
    const safeOptions = rawOpts.filter((o) => String(o.value ?? "") !== "");
    const selectValue = value === "" || value == null ? undefined : String(value);

    // Un campo puede traer sus opciones en vivo (ej. las interfaces reales de
    // un router) en vez de una lista fija. `field.onSync(values)` hace la
    // llamada y el padre actualiza el estado que alimenta `field.options`.
    const select = safeOptions.length > 8 || field.searchable ? (
      <SearchableSelect
        testId={testId}
        value={selectValue}
        onValueChange={(v) => onChange(field.name, v)}
        options={safeOptions}
        placeholder={field.placeholder || "Seleccionar"}
        searchPlaceholder={`Buscar ${(field.label || "").toLowerCase()}…`}
        clearable={!field.required}
      />
    ) : (
      <Select value={selectValue} onValueChange={(v) => onChange(field.name, v)}>
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder={field.placeholder || "Seleccionar"} />
        </SelectTrigger>
        <SelectContent>
          {safeOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Sin opciones disponibles</div>
          ) : (
            safeOptions.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    );

    if (!field.onSync) return select;
    return <SyncableSelectRow field={field} values={values} select={select} />;
  }

  if (field.type === "multiselect") {
    return (
      <MultiSelectField field={field} value={value} onChange={onChange} testId={testId} values={values} />
    );
  }

  if (field.type === "mac-picker") {
    return (
      <MacPickerField field={field} value={value} onChange={onChange} testId={testId} inputId={inputId} />
    );
  }

  const hasSuggestions = field.suggestions && field.suggestions.length > 0;

  if (hasSuggestions) {
    return (
      <SuggestionInputDropdown
        inputId={inputId}
        testId={testId}
        field={field}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <Input
      id={inputId}
      data-testid={testId}
      type={field.type || "text"}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        const next = field.type === "number" ? (raw === "" ? "" : Number(raw)) : raw;
        onChange(field.name, next);
      }}
      placeholder={field.placeholder}
      required={field.required}
    />
  );
}

function MultiSelectField({ field, value, onChange, testId, values }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rawOpts = typeof field.options === "function" ? field.options(values) : (field.options || []);
  const options = rawOpts.filter((o) => String(o.value ?? "") !== "");
  const selected = Array.isArray(value) ? value.map(String) : [];
  const filtered = q
    ? options.filter((o) => String(o.label).toLowerCase().includes(q.toLowerCase()))
    : options;

  const toggle = (v) => {
    const s = new Set(selected);
    if (s.has(v)) s.delete(v); else s.add(v);
    onChange(field.name, Array.from(s));
  };

  const remove = (v) => onChange(field.name, selected.filter((x) => x !== v));

  const selectedOptions = selected
    .map((s) => options.find((o) => String(o.value) === s))
    .filter(Boolean);

  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        data-testid={testId}
        className="w-full min-h-[40px] rounded-md border border-input bg-background px-2 py-1.5 text-sm text-left hover:bg-accent/20 transition-colors flex flex-wrap items-center gap-1 cursor-pointer"
      >
        {selectedOptions.length === 0 && (
          <span className="text-muted-foreground text-xs">{field.placeholder || "Seleccionar…"}</span>
        )}
        {selectedOptions.map((o) => (
          <span
            key={o.value}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-md border bg-primary/10 border-primary/30"
            data-testid={`${testId}-chip-${o.value}`}
          >
            <span className="truncate max-w-[180px]">{o.label}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); remove(String(o.value)); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); remove(String(o.value)); } }}
              className="ml-0.5 hover:text-red-400 cursor-pointer"
              data-testid={`${testId}-remove-${o.value}`}
            >
              <X className="w-3 h-3" />
            </span>
          </span>
        ))}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <div className="mt-1 border border-border rounded-md bg-background shadow-md overflow-hidden">
          <div className="p-2 border-b border-border">
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              className="h-8 text-xs"
              data-testid={`${testId}-search`}
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">Sin opciones</div>
            )}
            {filtered.map((o) => {
              const isChecked = selected.includes(String(o.value));
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
                  data-testid={`${testId}-option-${o.value}`}
                >
                  <Checkbox checked={isChecked} onCheckedChange={() => toggle(String(o.value))} />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-border flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground font-mono">{selected.length} seleccionados</span>
              <button
                type="button"
                onClick={() => onChange(field.name, [])}
                className="text-muted-foreground hover:text-foreground underline"
                data-testid={`${testId}-clear`}
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MacPickerField({ field, value, onChange, testId, inputId }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("unassigned"); // all | assigned | unassigned

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/onus");
      setItems(data);
    } catch (e) { toast.error(formatApiError(e)); }
    setLoading(false);
  };

  useEffect(() => { if (pickerOpen) load(); }, [pickerOpen]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = items;
    if (filter === "assigned") out = out.filter((x) => x.status === "active");
    else if (filter === "unassigned") out = out.filter((x) => x.status !== "active");
    if (s) out = out.filter((x) =>
      (x.mac || "").toLowerCase().includes(s) ||
      (x.onu_serial || "").toLowerCase().includes(s) ||
      (x.full_name || "").toLowerCase().includes(s) ||
      (x.ip_address || "").toLowerCase().includes(s)
    );
    return out;
  }, [items, q, filter]);

  const isValidMac = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(value || "").trim());

  const pick = (mac) => {
    onChange(field.name, String(mac).toLowerCase());
    setPickerOpen(false);
    toast.success(`MAC ${mac} agregada`);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          id={inputId}
          data-testid={testId}
          value={value || ""}
          onChange={(e) => onChange(field.name, e.target.value)}
          placeholder={field.placeholder || "aa:bb:cc:dd:ee:ff"}
          className="font-mono"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
          data-testid={`${testId}-search-btn`}
          className="shrink-0 gap-1"
        >
          <Search className="w-4 h-4" /> Buscar
        </Button>
      </div>
      {value && (
        <div className={`text-[10px] font-mono ${isValidMac ? "text-emerald-400" : "text-amber-400"}`}>
          {isValidMac ? "✓ Formato MAC válido" : "⚠ Formato esperado: aa:bb:cc:dd:ee:ff"}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-primary" /> Buscar MAC de la ONU
            </DialogTitle>
            <DialogDescription>
              Elige la MAC detectada por la OLT para amarrarla a la IP del cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                data-testid={`${testId}-picker-search`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por MAC, serial, cliente o IP…"
                className="h-9 text-sm"
              />
              <select
                data-testid={`${testId}-picker-filter`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="unassigned">Sin asignar</option>
                <option value="all">Todas</option>
                <option value="assigned">Solo activas</option>
              </select>
            </div>
            <ScrollArea className="h-80 rounded-md border border-border">
              {loading && <div className="p-4 text-center text-xs text-muted-foreground">Buscando ONUs…</div>}
              {!loading && filtered.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
                  No se encontraron MACs con ese criterio.
                </div>
              )}
              <div className="divide-y divide-border">
                {filtered.map((o, idx) => (
                  <button
                    type="button"
                    key={o.client_id || idx}
                    onClick={() => pick(o.mac)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent transition-colors"
                    data-testid={`${testId}-picker-item-${o.mac}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${o.status === "active" ? "bg-emerald-400" : "bg-slate-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-primary">{o.mac}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        <span className="font-medium text-foreground">{o.full_name || "—"}</span>
                        {o.onu_serial && <> · SN <code>{o.onu_serial}</code></>}
                        {o.ip_address && <> · IP {o.ip_address}</>}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[9px] uppercase font-mono">
                      {o.status || "—"}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="text-[10px] text-muted-foreground font-mono">
              {filtered.length} MACs mostradas
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SuggestionInputDropdown({ inputId, testId, field, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const suggestions = field.suggestions || [];
  const items = filter
    ? suggestions.filter((s) => String(s).toLowerCase().includes(filter.toLowerCase()))
    : suggestions;
  const cleanSel = String(value || "").trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Input
          id={inputId}
          data-testid={testId}
          type={field.type || "text"}
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={field.placeholder}
          required={field.required}
          className="pr-9"
          autoComplete="off"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
            title="Ver disponibles"
            data-testid={`${testId}-toggle`}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        className="z-[1200] p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-testid={`${testId}-panel`}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          <span>Disponibles</span>
          <span className="font-mono text-primary">{items.length}</span>
          <span className="text-muted-foreground">/ {suggestions.length}</span>
          <input
            className="ml-auto h-6 rounded bg-transparent border border-border px-2 text-xs font-mono w-32 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="filtrar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid={`${testId}-filter`}
          />
        </div>
        <ul
          className="max-h-80 overflow-y-auto overscroll-contain divide-y divide-border/60 scroll-smooth"
          style={{ scrollbarGutter: "stable" }}
          data-testid={`${testId}-list`}
          onWheel={(e) => e.stopPropagation()}
        >
          {items.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground italic">Sin coincidencias.</li>
          )}
          {items.map((s) => {
            const isSel = String(s) === cleanSel;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => { onChange(field.name, s); setOpen(false); }}
                  data-testid={`${testId}-opt-${s}`}
                  className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors flex items-center gap-2 ${
                    isSel
                      ? "bg-primary/15 text-primary border-l-2 border-primary"
                      : "border-l-2 border-transparent hover:bg-accent/40 hover:border-primary/40"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isSel ? "bg-primary shadow-[0_0_6px_rgba(251,146,60,0.7)]" : "bg-emerald-400/70"}`} />
                  <span className="flex-1 truncate">{s}</span>
                  {isSel && <span className="text-[10px] uppercase tracking-widest text-primary">seleccionada</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
