import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Inbox, MessageCircle, Send } from "lucide-react";

/**
 * Header widget aggregating incoming messages from WhatsApp and Telegram.
 * Real Telegram integration lands later — for now the panel shows any
 * incoming record whose `channel` is set to "telegram" (mocked/simulated).
 */
export default function InboxWidget() {
  const [messages, setMessages] = useState([]);
  const [unseen, setUnseen] = useState(() => Number(localStorage.getItem("netops-inbox-seen") || 0));

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/inbox");
      setMessages(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const wa = useMemo(() => messages.filter((m) => (m.channel || "whatsapp") === "whatsapp"), [messages]);
  const tg = useMemo(() => messages.filter((m) => m.channel === "telegram"), [messages]);
  const total = messages.length;
  const badgeCount = Math.max(0, total - unseen);

  const markSeen = () => {
    localStorage.setItem("netops-inbox-seen", String(total));
    setUnseen(total);
  };

  return (
    <Popover onOpenChange={(o) => { if (o) markSeen(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="inbox-trigger"
          className="relative flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card hover:bg-accent transition-colors"
        >
          <Inbox className="w-4 h-4" />
          <span className="text-xs font-medium">Mensajes</span>
          <Badge
            variant="outline"
            className={`ml-1 h-4 min-w-4 px-1 text-[10px] font-mono ${badgeCount > 0 ? "border-primary/40 text-primary bg-primary/10" : ""}`}
            data-testid="inbox-count"
          >
            {total}
          </Badge>
          {badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0 max-h-[70vh] overflow-hidden flex flex-col" data-testid="inbox-panel">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Bandeja de mensajes</div>
          <div className="mt-1 text-sm font-medium">
            {wa.length} WhatsApp · {tg.length} Telegram
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {total === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">No hay mensajes entrantes.</div>
          ) : (
            messages.slice(0, 20).map((m) => {
              const isTg = m.channel === "telegram";
              const Icon = isTg ? Send : MessageCircle;
              const tint = isTg ? "text-sky-400" : "text-emerald-400";
              return (
                <Link
                  key={m.id}
                  to={`/whatsapp`}
                  className="px-4 py-2 flex items-start gap-2 border-b border-border/60 hover:bg-accent transition-colors"
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tint}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-2">
                      <span>{isTg ? "Telegram" : "WhatsApp"}</span>
                      <span>·</span>
                      <span className="truncate">{m.phone}</span>
                      <span className="ml-auto">{m.created_at?.slice(11, 16)}</span>
                    </div>
                    <div className="text-sm truncate">{m.body}</div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
