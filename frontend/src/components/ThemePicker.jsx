import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Paintbrush, Check } from "lucide-react";

/**
 * Full theme presets — each one adjusts background, card, border and accent
 * colors together, plus a subtle CSS gradient painted behind the app.
 * The gradient is always low-opacity + fixed, so it never hurts legibility.
 */
export const THEMES = [
  // Oscuros
  {
    key: "midnight", label: "Medianoche", kind: "dark",
    vars: { "--background": "240 10% 4%", "--card": "240 10% 6%", "--popover": "240 10% 8%", "--muted": "240 6% 12%", "--accent": "240 6% 14%", "--border": "240 10% 15%", "--input": "240 10% 15%", "--foreground": "0 0% 98%", "--muted-foreground": "240 5% 65%", "--primary": "210 100% 55%", "--ring": "210 100% 55%" },
    gradient: "radial-gradient(1100px circle at 15% -10%, hsl(210 100% 55% / 0.09), transparent 60%), radial-gradient(900px circle at 85% 110%, hsl(210 100% 55% / 0.06), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(210 100% 55%), hsl(240 10% 6%))",
  },
  {
    key: "ocean", label: "Océano", kind: "dark",
    vars: { "--background": "205 40% 5%", "--card": "205 30% 8%", "--popover": "205 30% 10%", "--muted": "205 25% 12%", "--accent": "205 25% 14%", "--border": "205 25% 18%", "--input": "205 25% 18%", "--foreground": "0 0% 98%", "--muted-foreground": "205 15% 70%", "--primary": "190 90% 55%", "--ring": "190 90% 55%" },
    gradient: "radial-gradient(1100px circle at 20% -10%, hsl(190 90% 55% / 0.12), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(215 80% 50% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(190 90% 55%), hsl(215 80% 30%))",
  },
  {
    key: "forest", label: "Bosque", kind: "dark",
    vars: { "--background": "155 25% 5%", "--card": "155 20% 8%", "--popover": "155 20% 10%", "--muted": "155 15% 13%", "--accent": "155 15% 15%", "--border": "155 15% 18%", "--input": "155 15% 18%", "--foreground": "0 0% 98%", "--muted-foreground": "155 10% 70%", "--primary": "160 84% 42%", "--ring": "160 84% 42%" },
    gradient: "radial-gradient(1000px circle at 10% -5%, hsl(160 84% 42% / 0.10), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(150 60% 40% / 0.08), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(160 84% 42%), hsl(155 40% 12%))",
  },
  {
    key: "sunset", label: "Amanecer", kind: "dark",
    vars: { "--background": "20 25% 5%", "--card": "20 20% 8%", "--popover": "20 20% 10%", "--muted": "20 15% 13%", "--accent": "20 15% 15%", "--border": "20 15% 18%", "--input": "20 15% 18%", "--foreground": "0 0% 98%", "--muted-foreground": "20 15% 72%", "--primary": "24 95% 55%", "--ring": "24 95% 55%" },
    gradient: "radial-gradient(1100px circle at 15% -10%, hsl(24 95% 55% / 0.12), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(346 84% 55% / 0.09), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(24 95% 55%), hsl(346 84% 45%))",
  },
  {
    key: "violet", label: "Violeta", kind: "dark",
    vars: { "--background": "265 30% 5%", "--card": "265 25% 8%", "--popover": "265 25% 10%", "--muted": "265 20% 13%", "--accent": "265 20% 15%", "--border": "265 20% 18%", "--input": "265 20% 18%", "--foreground": "0 0% 98%", "--muted-foreground": "265 15% 70%", "--primary": "262 83% 62%", "--ring": "262 83% 62%" },
    gradient: "radial-gradient(1100px circle at 20% -10%, hsl(262 83% 62% / 0.14), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(220 80% 60% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(262 83% 62%), hsl(240 80% 30%))",
  },
  {
    key: "graphite", label: "Grafito", kind: "dark",
    vars: { "--background": "220 10% 7%", "--card": "220 8% 10%", "--popover": "220 8% 12%", "--muted": "220 6% 15%", "--accent": "220 6% 17%", "--border": "220 6% 20%", "--input": "220 6% 20%", "--foreground": "0 0% 98%", "--muted-foreground": "220 6% 70%", "--primary": "38 92% 55%", "--ring": "38 92% 55%" },
    gradient: "radial-gradient(1200px circle at 50% -20%, hsl(38 92% 55% / 0.06), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(38 92% 55%), hsl(220 8% 15%))",
  },
  {
    key: "rose", label: "Terracota", kind: "dark",
    vars: { "--background": "10 25% 6%", "--card": "10 20% 9%", "--popover": "10 20% 11%", "--muted": "10 15% 14%", "--accent": "10 15% 16%", "--border": "10 15% 19%", "--input": "10 15% 19%", "--foreground": "0 0% 98%", "--muted-foreground": "10 15% 72%", "--primary": "346 84% 60%", "--ring": "346 84% 60%" },
    gradient: "radial-gradient(1100px circle at 20% -10%, hsl(346 84% 60% / 0.12), transparent 60%), radial-gradient(900px circle at 100% 110%, hsl(24 95% 55% / 0.08), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(346 84% 60%), hsl(24 60% 25%))",
  },
  {
    key: "neon", label: "Neón", kind: "dark",
    vars: { "--background": "240 15% 4%", "--card": "240 12% 7%", "--popover": "240 12% 9%", "--muted": "240 10% 12%", "--accent": "240 10% 14%", "--border": "240 10% 17%", "--input": "240 10% 17%", "--foreground": "0 0% 98%", "--muted-foreground": "240 8% 72%", "--primary": "84 72% 48%", "--ring": "84 72% 48%" },
    gradient: "radial-gradient(1100px circle at 15% -10%, hsl(84 72% 48% / 0.10), transparent 60%), radial-gradient(900px circle at 90% 100%, hsl(190 90% 55% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(84 72% 48%), hsl(190 90% 45%))",
  },
  // Claros
  {
    key: "paper", label: "Papel", kind: "light",
    vars: { "--background": "0 0% 98%", "--card": "0 0% 100%", "--popover": "0 0% 100%", "--muted": "220 14% 94%", "--accent": "220 14% 92%", "--border": "220 13% 88%", "--input": "220 13% 88%", "--foreground": "222 47% 11%", "--muted-foreground": "215 16% 42%", "--primary": "222 89% 55%", "--ring": "222 89% 55%" },
    gradient: "radial-gradient(1200px circle at 10% -10%, hsl(222 89% 55% / 0.10), transparent 60%), radial-gradient(1000px circle at 100% 110%, hsl(200 80% 60% / 0.08), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(222 89% 55%), hsl(0 0% 96%))",
  },
  {
    key: "arctic", label: "Ártico", kind: "light",
    vars: { "--background": "210 40% 96%", "--card": "0 0% 100%", "--popover": "0 0% 100%", "--muted": "210 30% 92%", "--accent": "210 30% 90%", "--border": "210 25% 85%", "--input": "210 25% 85%", "--foreground": "215 40% 15%", "--muted-foreground": "215 20% 40%", "--primary": "195 92% 42%", "--ring": "195 92% 42%" },
    gradient: "radial-gradient(1100px circle at 20% -10%, hsl(195 92% 55% / 0.14), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(220 80% 60% / 0.10), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(195 92% 42%), hsl(210 40% 92%))",
  },
  {
    key: "sand", label: "Arena", kind: "light",
    vars: { "--background": "40 40% 96%", "--card": "40 30% 99%", "--popover": "40 30% 99%", "--muted": "40 25% 92%", "--accent": "40 25% 90%", "--border": "40 20% 85%", "--input": "40 20% 85%", "--foreground": "30 30% 15%", "--muted-foreground": "30 15% 40%", "--primary": "24 90% 48%", "--ring": "24 90% 48%" },
    gradient: "radial-gradient(1100px circle at 20% -10%, hsl(24 90% 55% / 0.14), transparent 60%), radial-gradient(900px circle at 100% 110%, hsl(346 80% 60% / 0.09), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(24 90% 48%), hsl(40 40% 92%))",
  },
  {
    key: "mint", label: "Menta", kind: "light",
    vars: { "--background": "150 30% 96%", "--card": "0 0% 100%", "--popover": "0 0% 100%", "--muted": "150 20% 92%", "--accent": "150 20% 90%", "--border": "150 15% 85%", "--input": "150 15% 85%", "--foreground": "160 35% 14%", "--muted-foreground": "160 15% 38%", "--primary": "160 76% 36%", "--ring": "160 76% 36%" },
    gradient: "radial-gradient(1100px circle at 10% -5%, hsl(160 84% 42% / 0.13), transparent 60%), radial-gradient(900px circle at 100% 100%, hsl(190 80% 50% / 0.09), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(160 76% 36%), hsl(150 30% 92%))",
  },
  // Combos: fondos coloridos + texto legible con alto contraste
  {
    key: "combo-blue-white", label: "Azul · Blanco", kind: "combo",
    vars: { "--background": "215 55% 18%", "--card": "215 45% 22%", "--popover": "215 45% 24%", "--muted": "215 35% 28%", "--accent": "215 35% 30%", "--border": "215 30% 34%", "--input": "215 30% 34%", "--foreground": "0 0% 98%", "--muted-foreground": "215 20% 82%", "--primary": "200 100% 70%", "--ring": "200 100% 70%" },
    gradient: "radial-gradient(1100px circle at 10% 0%, hsl(200 100% 60% / 0.12), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(215 65% 40%), hsl(0 0% 98%))",
  },
  {
    key: "combo-green-white", label: "Verde · Blanco", kind: "combo",
    vars: { "--background": "150 40% 15%", "--card": "150 32% 19%", "--popover": "150 32% 21%", "--muted": "150 25% 25%", "--accent": "150 25% 27%", "--border": "150 22% 32%", "--input": "150 22% 32%", "--foreground": "0 0% 98%", "--muted-foreground": "150 12% 82%", "--primary": "150 80% 65%", "--ring": "150 80% 65%" },
    gradient: "radial-gradient(1000px circle at 15% -5%, hsl(150 70% 45% / 0.14), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(150 60% 32%), hsl(0 0% 98%))",
  },
  {
    key: "combo-pink-dark", label: "Rosa · Texto oscuro", kind: "combo",
    vars: { "--background": "340 65% 92%", "--card": "340 55% 96%", "--popover": "340 55% 97%", "--muted": "340 40% 88%", "--accent": "340 40% 86%", "--border": "340 30% 78%", "--input": "340 30% 78%", "--foreground": "340 40% 12%", "--muted-foreground": "340 25% 32%", "--primary": "340 82% 45%", "--ring": "340 82% 45%" },
    gradient: "radial-gradient(1100px circle at 20% 0%, hsl(340 85% 65% / 0.18), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(340 82% 60%), hsl(340 60% 92%))",
  },
  {
    key: "combo-violet-white", label: "Morado · Blanco", kind: "combo",
    vars: { "--background": "270 45% 20%", "--card": "270 35% 25%", "--popover": "270 35% 27%", "--muted": "270 28% 30%", "--accent": "270 28% 32%", "--border": "270 25% 36%", "--input": "270 25% 36%", "--foreground": "0 0% 98%", "--muted-foreground": "270 20% 82%", "--primary": "280 90% 72%", "--ring": "280 90% 72%" },
    gradient: "radial-gradient(1100px circle at 15% -10%, hsl(280 90% 65% / 0.18), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(275 65% 45%), hsl(0 0% 98%))",
  },
  {
    key: "combo-gray-white", label: "Gris · Blanco", kind: "combo",
    vars: { "--background": "220 8% 20%", "--card": "220 6% 24%", "--popover": "220 6% 26%", "--muted": "220 5% 28%", "--accent": "220 5% 30%", "--border": "220 5% 34%", "--input": "220 5% 34%", "--foreground": "0 0% 98%", "--muted-foreground": "220 5% 78%", "--primary": "0 0% 90%", "--ring": "0 0% 90%" },
    gradient: "radial-gradient(1000px circle at 50% -10%, hsl(220 20% 40% / 0.14), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(220 8% 35%), hsl(0 0% 95%))",
  },
  {
    key: "combo-silver-black", label: "Plata · Negro", kind: "combo",
    vars: { "--background": "220 12% 85%", "--card": "220 15% 92%", "--popover": "220 15% 95%", "--muted": "220 12% 80%", "--accent": "220 12% 78%", "--border": "220 10% 72%", "--input": "220 10% 72%", "--foreground": "220 30% 10%", "--muted-foreground": "220 15% 30%", "--primary": "220 70% 32%", "--ring": "220 70% 32%" },
    gradient: "radial-gradient(1100px circle at 15% -10%, hsl(220 40% 60% / 0.14), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(220 12% 65%), hsl(220 40% 15%))",
  },
  {
    key: "combo-sky-navy", label: "Cielo · Marino", kind: "combo",
    vars: { "--background": "205 80% 88%", "--card": "205 70% 94%", "--popover": "205 70% 96%", "--muted": "205 50% 84%", "--accent": "205 50% 82%", "--border": "205 40% 74%", "--input": "205 40% 74%", "--foreground": "215 65% 15%", "--muted-foreground": "215 35% 32%", "--primary": "215 80% 35%", "--ring": "215 80% 35%" },
    gradient: "radial-gradient(1100px circle at 20% -5%, hsl(205 90% 70% / 0.20), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(205 80% 60%), hsl(215 65% 20%))",
  },
  {
    key: "combo-lime-forest", label: "Lima · Bosque", kind: "combo",
    vars: { "--background": "80 45% 88%", "--card": "80 35% 94%", "--popover": "80 35% 96%", "--muted": "80 25% 84%", "--accent": "80 25% 82%", "--border": "80 20% 74%", "--input": "80 20% 74%", "--foreground": "150 45% 14%", "--muted-foreground": "150 20% 30%", "--primary": "150 75% 25%", "--ring": "150 75% 25%" },
    gradient: "radial-gradient(1100px circle at 15% -5%, hsl(80 70% 60% / 0.20), transparent 60%)",
    swatch: "linear-gradient(135deg, hsl(80 60% 55%), hsl(150 65% 22%))",
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
  // Reapply wallpaper override if set (custom URL wins over preset key).
  const customWall = localStorage.getItem(WALLPAPER_KEY + "-custom");
  const wallKey = localStorage.getItem(WALLPAPER_KEY);
  if (customWall) applyWallpaper(null, customWall);
  else if (wallKey && wallKey !== "none") applyWallpaper(wallKey);
  // Reapply custom primary override if set
  const custom = localStorage.getItem(CUSTOM_KEY);
  if (custom) {
    root.style.setProperty("--primary", custom);
    root.style.setProperty("--ring", custom);
  }
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

const CUSTOM_KEY = "netops-custom-primary";
const WALLPAPER_KEY = "netops-wallpaper";

/**
 * Preset wallpapers rendered as pure CSS layered gradients (no external
 * assets needed). Users can also upload their own image which gets stored
 * as a base64 data URL in localStorage.
 */
export const WALLPAPERS = [
  { key: "none", label: "Sin fondo", css: null },
  {
    key: "sky",
    label: "Cielo",
    css: "linear-gradient(180deg, hsl(210 80% 15% / 0.45), hsl(210 60% 5% / 0.6) 70%), radial-gradient(600px circle at 80% 25%, hsl(210 100% 80% / 0.25), transparent 65%)",
  },
  {
    key: "stars",
    label: "Estrellas",
    css: "radial-gradient(1px 1px at 20% 30%, #fff 100%, transparent), radial-gradient(1px 1px at 60% 70%, #fff 100%, transparent), radial-gradient(1px 1px at 80% 10%, #ffe 100%, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #fff 100%, transparent), radial-gradient(1px 1px at 15% 60%, #cfe 100%, transparent), radial-gradient(1px 1px at 90% 45%, #ffd 100%, transparent), linear-gradient(180deg, #050510, #0a0a1e)",
  },
  {
    key: "moon",
    label: "Luna",
    css: "radial-gradient(220px circle at 82% 22%, hsl(45 90% 92% / 0.85) 0%, hsl(45 60% 70% / 0.4) 40%, transparent 65%), radial-gradient(500px circle at 82% 22%, hsl(45 80% 60% / 0.15), transparent 60%), linear-gradient(180deg, #060814, #0b1023)",
  },
  {
    key: "aurora",
    label: "Aurora",
    css: "linear-gradient(120deg, hsl(160 84% 42% / 0.25), transparent 40%), linear-gradient(210deg, hsl(262 83% 62% / 0.3), transparent 45%), linear-gradient(180deg, #050510, #0a0d18)",
  },
];

export function applyWallpaper(key, customUrl) {
  const root = document.documentElement;
  if (customUrl) {
    root.style.setProperty(
      "--app-gradient",
      `linear-gradient(hsl(var(--background) / 0.55), hsl(var(--background) / 0.55)), url('${customUrl}') center/cover no-repeat fixed`,
    );
    return;
  }
  const w = WALLPAPERS.find((x) => x.key === key);
  if (!w || !w.css) return; // fallback to theme gradient
  root.style.setProperty("--app-gradient", w.css);
}

function hexToHsl(hex) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255, g = ((int >> 8) & 255) / 255, b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
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
  const [custom, setCustom] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(CUSTOM_KEY) || "" : ""
  );
  const [wallpaper, setWallpaper] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(WALLPAPER_KEY) || "none" : "none"
  );
  const [customWall, setCustomWall] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(WALLPAPER_KEY + "-custom") || "" : ""
  );

  useEffect(() => {
    if (customWall) applyWallpaper(null, customWall);
    else if (wallpaper !== "none") applyWallpaper(wallpaper);
    else {
      const t = THEMES.find((x) => x.key === active) || THEMES[0];
      document.documentElement.style.setProperty("--app-gradient", t.gradient || "none");
    }
    localStorage.setItem(WALLPAPER_KEY, wallpaper);
    if (customWall) localStorage.setItem(WALLPAPER_KEY + "-custom", customWall);
    else localStorage.removeItem(WALLPAPER_KEY + "-custom");
  }, [wallpaper, customWall, active]);

  useEffect(() => {
    const theme = THEMES.find((t) => t.key === active) || THEMES[0];
    applyTheme(theme, sidebar);
    localStorage.setItem(STORAGE_KEY, theme.key);
    if (custom) {
      document.documentElement.style.setProperty("--primary", custom);
      document.documentElement.style.setProperty("--ring", custom);
    }
  }, [active, sidebar, custom]);

  useEffect(() => {
    applySidebarTint(sidebar);
    localStorage.setItem(SIDEBAR_KEY, sidebar);
  }, [sidebar]);

  const current = THEMES.find((t) => t.key === active) || THEMES[0];
  const dark = THEMES.filter((t) => t.kind === "dark" || !t.kind);
  const light = THEMES.filter((t) => t.kind === "light");
  const combos = THEMES.filter((t) => t.kind === "combo");

  const setColor = (hex) => {
    const hsl = hexToHsl(hex);
    if (hsl) { setCustom(hsl); localStorage.setItem(CUSTOM_KEY, hsl); }
  };
  const clearCustom = () => {
    localStorage.removeItem(CUSTOM_KEY);
    setCustom("");
    const t = THEMES.find((x) => x.key === active);
    if (t) applyTheme(t, sidebar);
  };

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
      <PopoverContent side="right" align="end" className="w-96 p-3 max-h-[80vh] overflow-y-auto" data-testid="theme-picker-panel">
        <ThemeSection title="Oscuros" themes={dark} active={active} onPick={setActive} />
        <ThemeSection title="Claros" themes={light} active={active} onPick={setActive} />
        <ThemeSection title="Combos de color" themes={combos} active={active} onPick={setActive} />

        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Fondo de pantalla</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {WALLPAPERS.map((w) => {
              const isActive = w.key === wallpaper && !customWall;
              return (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => { setCustomWall(""); setWallpaper(w.key); }}
                  data-testid={`wall-${w.key}`}
                  className={`rounded-md border overflow-hidden text-left transition-colors ${isActive ? "border-foreground" : "border-border hover:border-foreground/60"}`}
                >
                  <div className="h-12" style={{ backgroundImage: w.css || undefined, background: w.css ? undefined : "hsl(240 10% 8%)" }} />
                  <div className="text-[10px] font-mono uppercase px-2 py-1 bg-card truncate">{w.label}</div>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 3 * 1024 * 1024) { alert("Imagen mayor a 3MB"); return; }
                const reader = new FileReader();
                reader.onload = () => { setCustomWall(reader.result); setWallpaper("custom"); };
                reader.readAsDataURL(file);
              }}
              data-testid="wall-custom-input"
            />
            <span className="px-2 py-1 rounded-md border border-border hover:bg-accent">Subir imagen…</span>
            {customWall && (
              <button type="button" onClick={() => { setCustomWall(""); setWallpaper("none"); }} className="ml-auto text-[11px] underline">
                Quitar
              </button>
            )}
          </label>
        </div>

        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">Color primario personalizado</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-md border border-border bg-transparent cursor-pointer"
              data-testid="custom-color"
            />
            <div className="flex-1 text-[11px] text-muted-foreground font-mono">
              {custom ? `HSL personalizado activo` : "Sobrescribe el color primario del tema"}
            </div>
            {custom && (
              <button
                type="button"
                onClick={clearCustom}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Restaurar
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Elige claro u oscuro. Los gradientes se mantienen sutiles para no afectar la lectura.
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeSection({ title, themes, active, onPick }) {
  if (!themes.length) return null;
  return (
    <div className="mb-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              data-testid={`theme-${t.key}`}
              onClick={() => onPick(t.key)}
              className={`relative rounded-md border overflow-hidden text-left transition-colors ${isActive ? "border-foreground" : "border-border hover:border-foreground/60"}`}
            >
              <div
                className="h-14"
                style={{ background: `hsl(${t.vars["--background"]})`, backgroundImage: t.gradient }}
              />
              <div className="px-2 py-1.5 flex items-center gap-2 bg-card">
                <span className="w-3.5 h-3.5 rounded-full border border-border" style={{ background: t.swatch }} />
                <span className="text-xs font-medium truncate">{t.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
