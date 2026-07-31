import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Bell, ClipboardList, WifiOff, ListTodo, UserX } from "lucide-react";

/**
 * Compact header widget listing operational pending items:
 *   • Open leads (new / in_progress)
 *   • Disconnected clients (offline > threshold)
 *   • Backlog + Today tasks
 *   • Suspended clients
 *
 * Refreshes every 45s so it reflects new activity without a full reload.
 */
export default function PendingBadges() {
  const [data, setData] = useState({ leads: [], disconnected: [], tasks: [], suspended: [] });

  const load = useCallback(async () => {
    try {
      const [l, d, t, c] = await Promise.all([
        api.get("/leads"),
        api.get("/disconnected"),
        api.get("/tasks"),
        api.get("/clients"),
      ]);
      setData({
        leads: l.data.filter((x) => ["new", "in_progress"].includes(x.status)),
        disconnected: d.data,
        tasks: t.data.filter((x) => ["backlog", "today"].includes(x.stage)),
        suspended: c.data.filter((x) => x.status === "suspended"),
      });
    } catch (err) {
      console.warn("[PendingBadges] load failed, will retry:", err);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 45000);
    return () => clearInterval(timer);
  }, [load]);

  const total = data.leads.length + data.disconnected.length + data.tasks.length + data.suspended.length;

  const sections = useMemo(
    () => [
      { key: "leads", label: "Leads abiertos", icon: ClipboardList, to: "/leads", items: data.leads, render: (x) => `${x.full_name} · ${x.type}` },
      { key: "disc", label: "Clientes desconectados", icon: WifiOff, to: "/desconectados", items: data.disconnected, render: (x) => `${x.full_name}${x.phone ? " · " + x.phone : ""}` },
      { key: "tasks", label: "Tareas pendientes", icon: ListTodo, to: "/tareas", items: data.tasks, render: (x) => `${x.title}${x.due_date ? " · " + x.due_date : ""}` },
      { key: "susp", label: "Clientes suspendidos", icon: UserX, to: "/clientes", items: data.suspended, render: (x) => `${x.full_name}${x.next_due_date ? " · vencido " + x.next_due_date.slice(0,10) : ""}` },
    ],
    [data],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="pending-trigger"
          className="relative flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card hover:bg-accent transition-colors"
          aria-label={`Pendientes: ${total}`}
        >
          <Bell className="w-4 h-4" />
          <span className="text-xs font-medium">Pendientes</span>
          <Badge
            variant="outline"
            className={`ml-1 h-4 min-w-4 px-1 text-[10px] font-mono ${total > 0 ? "border-primary/40 text-primary bg-primary/10" : ""}`}
            data-testid="pending-count"
          >
            {total}
          </Badge>
          {total > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0 max-h-[70vh] overflow-hidden flex flex-col" data-testid="pending-panel">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
            Bandeja de pendientes
          </div>
          <div className="mt-1 text-sm font-medium">
            {total > 0 ? `${total} elementos requieren atención` : "Todo al día"}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sections.map((s) => (
            <PendingSection key={s.key} {...s} />
          ))}
          {total === 0 && (
            <div className="p-6 text-xs text-muted-foreground text-center">
              No hay pendientes. Buen trabajo.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PendingSection({ label, icon: Icon, to, items, render }) {
  if (!items?.length) return null;
  const preview = items.slice(0, 4);
  const extra = items.length - preview.length;
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
          <Icon className="w-3 h-3" />
          {label}
        </div>
        <Link to={to} className="text-[11px] text-primary hover:underline">
          Ver todos ({items.length})
        </Link>
      </div>
      <ul>
        {preview.map((it, i) => (
          <li key={it.id || i} className="px-4 py-1.5 text-sm hover:bg-accent transition-colors">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-2 align-middle" />
            <span className="align-middle">{render(it)}</span>
          </li>
        ))}
        {extra > 0 && (
          <li className="px-4 py-1.5 text-xs text-muted-foreground">
            + {extra} más
          </li>
        )}
      </ul>
    </div>
  );
}
