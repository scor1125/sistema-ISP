import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Paintbrush, Check } from "lucide-react";

/**
 * Full theme presets — each one adjusts background, card, border and accent
 * colors together, plus a subtle CSS gradient painted behind the app.
 * The gradient is always low-opacity + fixed, so it never hurts legibility.
 */
export const THEMES = [
  {
    key: "midnight",
    label: "Medianoche",
    vars: {
      "--background": "240 10% 4%",
      "--card": "240 10% 6%",
      "--popover": "240 10% 8%",
      "--muted": "240 6% 12%",
      "--accent": "240 6% 14%",
      "--border": "240 10% 15%",
      "--input": "240 10% 15%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "240 5% 65%",
      "--primary": "210 100% 55%",
      "--ring": "210 100% 55%",
    },
    gradient:
      "radial-gradient(1100px circle at 15% -10%, hsl(210 100% 55% / 0.09), transparent 60%), radial-gradient(900px circle at 85% 110%, hsl(210 100% 55% / 0.06), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(210 100% 55%), hsl(240 10% 6%))",
  },
  {
    key: "ocean",
    label: "Océano",
    vars: {
      "--background": "205 40% 5%",
      "--card": "205 30% 8%",
      "--popover": "205 30% 10%",
      "--muted": "205 25% 12%",
      "--accent": "205 25% 14%",
      "--border": "205 25% 18%",
      "--input": "205 25% 18%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "205 15% 70%",
      "--primary": "190 90% 55%",
      "--ring": "190 90% 55%",
    },
    gradient:
      "radial-gradient(1100px circle at 20% -10%, hsl(190 90% 55% / 0.12), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(215 80% 50% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(190 90% 55%), hsl(215 80% 30%))",
  },
  {
    key: "forest",
    label: "Bosque",
    vars: {
      "--background": "155 25% 5%",
      "--card": "155 20% 8%",
      "--popover": "155 20% 10%",
      "--muted": "155 15% 13%",
      "--accent": "155 15% 15%",
      "--border": "155 15% 18%",
      "--input": "155 15% 18%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "155 10% 70%",
      "--primary": "160 84% 42%",
      "--ring": "160 84% 42%",
    },
    gradient:
      "radial-gradient(1000px circle at 10% -5%, hsl(160 84% 42% / 0.10), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(150 60% 40% / 0.08), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(160 84% 42%), hsl(155 40% 12%))",
  },
  {
    key: "sunset",
    label: "Amanecer",
    vars: {
      "--background": "20 25% 5%",
      "--card": "20 20% 8%",
      "--popover": "20 20% 10%",
      "--muted": "20 15% 13%",
      "--accent": "20 15% 15%",
      "--border": "20 15% 18%",
      "--input": "20 15% 18%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "20 15% 72%",
      "--primary": "24 95% 55%",
      "--ring": "24 95% 55%",
    },
    gradient:
      "radial-gradient(1100px circle at 15% -10%, hsl(24 95% 55% / 0.12), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(346 84% 55% / 0.09), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(24 95% 55%), hsl(346 84% 45%))",
  },
  {
    key: "violet",
    label: "Violeta",
    vars: {
      "--background": "265 30% 5%",
      "--card": "265 25% 8%",
      "--popover": "265 25% 10%",
      "--muted": "265 20% 13%",
      "--accent": "265 20% 15%",
      "--border": "265 20% 18%",
      "--input": "265 20% 18%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "265 15% 70%",
      "--primary": "262 83% 62%",
      "--ring": "262 83% 62%",
    },
    gradient:
      "radial-gradient(1100px circle at 20% -10%, hsl(262 83% 62% / 0.14), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(220 80% 60% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(262 83% 62%), hsl(240 80% 30%))",
  },
  {
    key: "graphite",
    label: "Grafito",
    vars: {
      "--background": "220 10% 7%",
      "--card": "220 8% 10%",
      "--popover": "220 8% 12%",
      "--muted": "220 6% 15%",
      "--accent": "220 6% 17%",
      "--border": "220 6% 20%",
      "--input": "220 6% 20%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "220 6% 70%",
      "--primary": "38 92% 55%",
      "--ring": "38 92% 55%",
    },
    gradient:
      "radial-gradient(1200px circle at 50% -20%, hsl(38 92% 55% / 0.06), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(38 92% 55%), hsl(220 8% 15%))",
  },
  {
    key: "rose",
    label: "Terracota",
    vars: {
      "--background": "10 25% 6%",
      "--card": "10 20% 9%",
      "--popover": "10 20% 11%",
      "--muted": "10 15% 14%",
      "--accent": "10 15% 16%",
      "--border": "10 15% 19%",
      "--input": "10 15% 19%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "10 15% 72%",
      "--primary": "346 84% 60%",
      "--ring": "346 84% 60%",
    },
    gradient:
      "radial-gradient(1100px circle at 20% -10%, hsl(346 84% 60% / 0.12), transparent 60%), radial-gradient(900px circle at 100% 110%, hsl(24 95% 55% / 0.08), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(346 84% 60%), hsl(24 60% 25%))",
  },
  {
    key: "neon",
    label: "Neón",
    vars: {
      "--background": "240 15% 4%",
      "--card": "240 12% 7%",
      "--popover": "240 12% 9%",
      "--muted": "240 10% 12%",
      "--accent": "240 10% 14%",
      "--border": "240 10% 17%",
      "--input": "240 10% 17%",
      "--foreground": "0 0% 98%",
      "--muted-foreground": "240 8% 72%",
      "--primary": "84 72% 48%",
      "--ring": "84 72% 48%",
    },
    gradient:
      "radial-gradient(1100px circle at 15% -10%, hsl(84 72% 48% / 0.10), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(190 90% 55% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(84 72% 48%), hsl(190 90% 45%))",
  },
];

const STORAGE_KEY = "netops-theme";
const SIDEBAR_KEY = "netops-sidebar-tint";
const LEGACY_ACCENT_KEY = "netops-accent"; // backwards-compat with earlier accent-only picker

/**
 * Extra tints for the sidebar background — always slightly lighter than the
 * base card colour, so users can distinguish the menu from the main canvas.
 * Values are HSL strings applied to the --sidebar-bg CSS variable.
 * The special key "auto" falls back to the current theme's --card value.
 */
export const SIDEBAR_TINTS = [
  { key: "auto",    label: "Automático (según tema)" },
  { key: "lighter", label: "Un poco más claro",  delta: 4 },
  { key: "soft",    label: "Suave elevado",      delta: 8 },
  { key: "bright",  label: "Bien iluminado",     delta: 12 },
  { key: "primary", label: "Con tinte primario",  usePrimary: true, delta: 6 },
  { key: "warm",    label: "Cálido",             overrideHue: 24, sat: 20, delta: 8 },
  { key: "cool",    label: "Fresco",             overrideHue: 210, sat: 25, delta: 8 },
];

function computeSidebarHsl(tintKey) {
  const root = document.documentElement;
  const card = getComputedStyle(root).getPropertyValue("--card").trim(); // "H S% L%"
  const primary = getComputedStyle(root).getPropertyValue("--primary").trim();
  if (!card) return "";
  const [h, s, l] = card.split(/\s+/).map((v) => parseFloat(v));
  const tint = SIDEBAR_TINTS.find((t) => t.key === tintKey);
  if (!tint || tint.key === "auto") return `${h} ${s}% ${l}%`;
  let hue = h, sat = s, light = l + (tint.delta || 0);
  if (tint.usePrimary && primary) {
    const [ph, ps] = primary.split(/\s+/).map((v) => parseFloat(v));
    if (!Number.isNaN(ph)) hue = ph;
    if (!Number.isNaN(ps)) sat = Math.min(ps, 40);
  }
  if (tint.overrideHue != null) hue = tint.overrideHue;
  if (tint.sat != null) sat = tint.sat;
  light = Math.max(4, Math.min(30, light));
  return `${hue} ${sat}% ${light}%`;
}

export function applySidebarTint(tintKey) {
  const hsl = computeSidebarHsl(tintKey);
  document.documentElement.style.setProperty("--sidebar-bg", hsl);
}

export function applyTheme(theme, tintKey) {
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.setProperty("--app-gradient", theme.gradient || "none");
  applySidebarTint(tintKey || localStorage.getItem(SIDEBAR_KEY) || "auto");
}

export function initThemeFromStorage() {
  let saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const legacy = localStorage.getItem(LEGACY_ACCENT_KEY);
    if (legacy) saved = "midnight";
  }
  const theme = THEMES.find((t) => t.key === saved) || THEMES[0];
  const tint = localStorage.getItem(SIDEBAR_KEY) || "auto";
  applyTheme(theme, tint);
  return theme.key;
}

export default function ThemePicker() {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return "midnight";
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((t) => t.key === saved) ? saved : "midnight";
  });
  const [sidebar, setSidebar] = useState(() => {
    if (typeof window === "undefined") return "auto";
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return SIDEBAR_TINTS.find((t) => t.key === saved) ? saved : "auto";
  });

  useEffect(() => {
    const theme = THEMES.find((t) => t.key === active) || THEMES[0];
    applyTheme(theme, sidebar);
    localStorage.setItem(STORAGE_KEY, theme.key);
  }, [active, sidebar]);

  useEffect(() => {
    // Re-apply tint when it changes so lightness follows the current theme.
    applySidebarTint(sidebar);
    localStorage.setItem(SIDEBAR_KEY, sidebar);
  }, [sidebar]);

  const current = THEMES.find((t) => t.key === active) || THEMES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="theme-picker-trigger"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md border border-border transition-colors"
        >
          <Paintbrush className="w-3.5 h-3.5" />
          <span className="uppercase tracking-widest font-mono flex-1 text-left">Tema</span>
          <span className="text-[10px] uppercase font-mono">{current.label}</span>
          <span
            className="w-4 h-4 rounded-full border border-border"
            style={{ background: current.swatch }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-3" data-testid="theme-picker-panel">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">
          Tema completo
        </div>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`theme-${t.key}`}
                onClick={() => setActive(t.key)}
                className={`relative rounded-md border overflow-hidden text-left transition-colors ${isActive ? "border-foreground" : "border-border hover:border-foreground/60"}`}
              >
                <div
                  className="h-14"
                  style={{
                    background: `hsl(${t.vars["--background"]})`,
                    backgroundImage: t.gradient,
                  }}
                />
                <div className="px-2 py-1.5 flex items-center gap-2 bg-card">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-border"
                    style={{ background: t.swatch }}
                  />
                  <span className="text-xs font-medium truncate">{t.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Cambia fondo, tarjetas, bordes y color primario. El gradiente se mantiene sutil para no afectar la lectura.
        </div>
      </PopoverContent>
    </Popover>
  );
}
