import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Paintbrush } from "lucide-react";

// Curated accent palette — sober, dashboard-friendly colors.
// Each entry: label + HSL string used for the CSS variable --primary.
export const ACCENT_COLORS = [
  { key: "blue",    label: "Azul",     hsl: "210 100% 55%" },
  { key: "emerald", label: "Esmeralda", hsl: "160 84% 42%" },
  { key: "cyan",    label: "Cian",     hsl: "190 90% 50%" },
  { key: "violet",  label: "Violeta",  hsl: "262 83% 62%" },
  { key: "amber",   label: "Ámbar",    hsl: "38 92% 55%" },
  { key: "rose",    label: "Rosa",     hsl: "346 84% 60%" },
  { key: "lime",    label: "Lima",     hsl: "84 72% 48%" },
  { key: "orange",  label: "Naranja",  hsl: "24 95% 55%" },
];

const STORAGE_KEY = "netops-accent";

export function applyAccent(hsl) {
  document.documentElement.style.setProperty("--primary", hsl);
  document.documentElement.style.setProperty("--ring", hsl);
}

export function initAccentFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const found = ACCENT_COLORS.find((c) => c.key === saved) || ACCENT_COLORS[0];
  applyAccent(found.hsl);
  return found.key;
}

export default function ThemePicker() {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return "blue";
    const saved = localStorage.getItem(STORAGE_KEY);
    return ACCENT_COLORS.find((c) => c.key === saved) ? saved : "blue";
  });

  useEffect(() => {
    const found = ACCENT_COLORS.find((c) => c.key === active) || ACCENT_COLORS[0];
    applyAccent(found.hsl);
    localStorage.setItem(STORAGE_KEY, found.key);
  }, [active]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="theme-picker-trigger"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md border border-border transition-colors"
        >
          <Paintbrush className="w-3.5 h-3.5" />
          <span className="uppercase tracking-widest font-mono">Tema</span>
          <span
            className="ml-auto w-4 h-4 rounded-full border border-border"
            style={{ background: `hsl(${ACCENT_COLORS.find((c) => c.key === active)?.hsl})` }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-64 p-3" data-testid="theme-picker-panel">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">
          Color de acento
        </div>
        <div className="grid grid-cols-4 gap-2">
          {ACCENT_COLORS.map((c) => {
            const isActive = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                title={c.label}
                data-testid={`theme-${c.key}`}
                onClick={() => setActive(c.key)}
                className={`h-10 rounded-md border transition-colors ${isActive ? "border-foreground ring-2 ring-offset-2 ring-offset-background" : "border-border hover:border-foreground/60"}`}
                style={{
                  background: `hsl(${c.hsl})`,
                  boxShadow: isActive ? `0 0 0 2px hsl(${c.hsl} / 0.4)` : undefined,
                }}
              >
                <span className="sr-only">{c.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          El color se aplica en botones, badges e íconos activos.
        </div>
      </PopoverContent>
    </Popover>
  );
}
