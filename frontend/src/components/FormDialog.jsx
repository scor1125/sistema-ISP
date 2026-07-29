import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * Reusable form dialog. `fields`: [{name,label,type,options?,placeholder?,required?}]
 * type: text | number | textarea | select
 */
export function FormDialog({ trigger, title, fields, initial, onSubmit, submitLabel = "Guardar", open, onOpenChange }) {
  const [values, setValues] = useState(initial || {});
  const [loading, setLoading] = useState(false);

  // If controlled, sync initial when opened
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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => {
              const val = values[f.name] ?? "";
              const key = `field-${f.name}`;
              const wrap = f.full ? "col-span-2" : "col-span-2 sm:col-span-1";
              const listId = f.suggestions?.length ? `${key}-list` : undefined;
              return (
                <div key={f.name} className={wrap}>
                  <Label htmlFor={key}>{f.label}</Label>
                  {f.type === "textarea" ? (
                    <Textarea id={key} data-testid={`input-${f.name}`} value={val}
                      onChange={(e)=>handleChange(f.name, e.target.value)} placeholder={f.placeholder} />
                  ) : f.type === "select" ? (
                    <Select value={String(val)} onValueChange={(v)=>handleChange(f.name, v)}>
                      <SelectTrigger data-testid={`input-${f.name}`}><SelectValue placeholder={f.placeholder || "Seleccionar"} /></SelectTrigger>
                      <SelectContent>
                        {f.options.map((o)=>(<SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Input id={key} data-testid={`input-${f.name}`}
                        type={f.type || "text"}
                        value={val}
                        list={listId}
                        onChange={(e)=>handleChange(f.name, f.type==="number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                        placeholder={f.placeholder} required={f.required} />
                      {listId && (
                        <datalist id={listId}>
                          {f.suggestions.slice(0, 500).map((s)=>(<option key={s} value={s} />))}
                        </datalist>
                      )}
                    </>
                  )}
                  {f.hint && <div className="mt-1 text-[11px] text-muted-foreground font-mono">{f.hint}</div>}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading} data-testid="form-submit">{loading ? "Guardando…" : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
