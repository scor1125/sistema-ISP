import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Texto de velocidad de un plan. Planes viejos solo tienen `speed_mbps`
 * (simétrico); los nuevos tienen `upload_mbps`/`download_mbps` por separado
 * y pueden ser distintos — se muestran ambos solo cuando de verdad difieren.
 */
export function planSpeedLabel(plan) {
  if (!plan) return "";
  const up = plan.upload_mbps ?? plan.speed_mbps;
  const down = plan.download_mbps ?? plan.speed_mbps;
  if (up == null && down == null) return "";
  if (up == null) return `${down} Mbps`;
  if (down == null || up === down) return `${up} Mbps`;
  return `${up}↑/${down}↓ Mbps`;
}
