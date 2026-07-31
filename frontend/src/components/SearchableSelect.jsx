import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Drop-in replacement for shadcn Select with a live search input on top.
 * API: `<SearchableSelect value onValueChange options={[{value,label}]} placeholder testId />`
 */
export function SearchableSelect({
  value, onValueChange, options = [], placeholder = "Seleccionar…",
  testId = "search-select", searchPlaceholder = "Buscar…", clearable = false, className,
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value ?? "")),
    [options, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background transition-colors hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-ring data-[state=open]:bg-accent/60 data-[state=open]:ring-1 data-[state=open]:ring-primary",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronDown className="h-4 w-4 opacity-60 shrink-0 transition-transform data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[220px]" align="start">
        <Command shouldFilter={true}>
          <CommandInput placeholder={searchPlaceholder} data-testid={`${testId}-input`} />
          <CommandList className="max-h-72">
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {clearable && (
                <CommandItem
                  onSelect={() => { onValueChange?.(""); setOpen(false); }}
                  className="text-muted-foreground"
                  data-testid={`${testId}-clear`}
                  value="__clear__"
                >
                  <X className="w-3 h-3 mr-2" /> Limpiar selección
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={String(o.value)}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => { onValueChange?.(String(o.value)); setOpen(false); }}
                  data-testid={`${testId}-opt-${o.value}`}
                >
                  <Check className={cn("w-4 h-4 mr-2", String(o.value) === String(value ?? "") ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
