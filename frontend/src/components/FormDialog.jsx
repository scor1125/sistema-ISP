import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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
                <Field key={f.name} field={f} value={values[f.name] ?? ""} onChange={handleChange} />
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

function Field({ field, value, onChange }) {
  const key = `field-${field.name}`;
  // In full-width dialogs, the parent grid supplies the column count;
  // full-span fields still span all columns via `full: true`.
  const wrapCls = field.full ? "col-span-full" : "";

  return (
    <div className={wrapCls}>
      <Label htmlFor={key}>{field.label}</Label>
      <FieldControl field={field} value={value} onChange={onChange} inputId={key} />
      {field.hint && (
        <div className="mt-1 text-[11px] text-muted-foreground font-mono">{field.hint}</div>
      )}
    </div>
  );
}

function FieldControl({ field, value, onChange, inputId }) {
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
    // Radix requires non-empty string values; guard defensively.
    const safeOptions = (field.options || []).filter((o) => String(o.value ?? "") !== "");
    const selectValue = value === "" || value == null ? undefined : String(value);
    // Auto-upgrade to searchable combobox for long lists so 200+ clients / users
    // stay usable with a live search input on top.
    if (safeOptions.length > 8 || field.searchable) {
      return (
        <SearchableSelect
          testId={testId}
          value={selectValue}
          onValueChange={(v) => onChange(field.name, v)}
          options={safeOptions}
          placeholder={field.placeholder || "Seleccionar"}
          searchPlaceholder={`Buscar ${(field.label || "").toLowerCase()}…`}
          clearable={!field.required}
        />
      );
    }
    return (
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
  }

  const hasSuggestions = field.suggestions && field.suggestions.length > 0;
  const listId = hasSuggestions ? `${inputId}-list` : undefined;

  return (
    <>
      <Input
        id={inputId}
        data-testid={testId}
        type={field.type || "text"}
        value={value}
        list={listId}
        onChange={(e) => {
          const raw = e.target.value;
          const next = field.type === "number" ? (raw === "" ? "" : Number(raw)) : raw;
          onChange(field.name, next);
        }}
        placeholder={field.placeholder}
        required={field.required}
      />
      {hasSuggestions && (
        <datalist id={listId}>
          {field.suggestions.slice(0, 500).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}
