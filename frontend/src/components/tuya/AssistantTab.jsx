import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bot, User as UserIcon, Send, Wrench, Sparkles, RotateCcw,
  AirVent, Power, Clock, Trash2, Pencil, Info, Loader2,
} from "lucide-react";
import { toast } from "sonner";

const TOOL_ICONS = {
  obtener_dispositivos_proyecto: AirVent,
  controlar_energia: Power,
  ver_detalle_dispositivo: Info,
  editar_dispositivo: Pencil,
  eliminar_dispositivo: Trash2,
  crear_automatizacion_horaria: Clock,
};

const TOOL_LABELS = {
  obtener_dispositivos_proyecto: "Listando dispositivos",
  controlar_energia: "Controlando energía",
  ver_detalle_dispositivo: "Consultando estado",
  editar_dispositivo: "Renombrando",
  eliminar_dispositivo: "Eliminando",
  crear_automatizacion_horaria: "Creando automatización",
};

const SUGGESTIONS = [
  "Muéstrame los aires conectados",
  "Apaga el aire de la sala",
  "¿Cuál es el estado del A/C oficina?",
  "Programa el A/C sala para prenderse a las 8am de lunes a viernes",
  "Renombra el aire 'Cuarto' a 'Habitación principal'",
];

function ToolCallCard({ call }) {
  const Icon = TOOL_ICONS[call.tool] || Wrench;
  const label = TOOL_LABELS[call.tool] || call.tool;
  const ok = call.result && !call.result.error;
  return (
    <div className={`rounded-md border px-2 py-1.5 text-[11px] flex items-start gap-2 ${
      ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
    }`} data-testid={`tuya-chat-toolcall-${call.tool}`}>
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${ok ? "text-emerald-500" : "text-red-500"}`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        {call.arguments && Object.keys(call.arguments).length > 0 && (
          <div className="font-mono text-muted-foreground text-[10px] truncate">
            {Object.entries(call.arguments).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}
          </div>
        )}
        {call.result?.error && (
          <div className="text-red-500 text-[10px] mt-0.5">✗ {call.result.error}</div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`tuya-chat-msg-${msg.role}`}>
      <div className={`w-7 h-7 rounded-md shrink-0 grid place-items-center ${
        isUser ? "bg-primary/15 text-primary" : "bg-muted text-foreground"
      }`}>
        {isUser ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={`max-w-[80%] space-y-1.5 ${isUser ? "items-end" : ""}`}>
        {msg.tool_calls?.length > 0 && (
          <div className="space-y-1">
            {msg.tool_calls.map((tc, i) => <ToolCallCard key={i} call={tc} />)}
          </div>
        )}
        {msg.content && (
          <div className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap leading-snug ${
            isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border"
          }`}>
            {msg.content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AssistantTab() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  // Stable per-mount session id
  const [sessionId] = useState(() => `smartlife-${Math.random().toString(36).slice(2, 10)}`);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get("/tuya/chat/history", { params: { session_id: sessionId } });
      setMessages(data);
    } catch { /* ignore for fresh session */ }
  }, [sessionId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    // Optimistic user message
    setMessages((m) => [...m, { role: "user", content: msg, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const { data } = await api.post("/tuya/chat", { session_id: sessionId, message: msg });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.text, tool_calls: data.tool_calls, created_at: new Date().toISOString() },
      ]);
    } catch (e) {
      const errMsg = formatApiError(e);
      toast.error(errMsg);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ Error: ${errMsg}`, created_at: new Date().toISOString() },
      ]);
    } finally { setSending(false); }
  };

  const reset = async () => {
    if (!window.confirm("¿Reiniciar la conversación? Se borrará el historial de este chat.")) return;
    try {
      await api.post("/tuya/chat/reset", null, { params: { session_id: sessionId } });
      setMessages([]);
      toast.success("Conversación reiniciada");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden flex flex-col h-[70vh] min-h-[500px]" data-testid="tuya-assistant">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-400 to-rose-500 grid place-items-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">Asistente Smart Life</div>
          <div className="text-[10px] text-muted-foreground font-mono">Claude Sonnet 4.6 · 6 herramientas Tuya</div>
        </div>
        <Button variant="ghost" size="sm" onClick={reset} data-testid="tuya-chat-reset">
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reiniciar
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <Bot className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground mb-3">
              Escribe una petición en lenguaje natural y ejecutaré las acciones en tus A/Cs de Tuya.
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center max-w-xl mx-auto">
              {SUGGESTIONS.map((s, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent text-[11px]"
                  onClick={() => send(s)}
                  data-testid={`tuya-chat-suggestion-${i}`}
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
        {sending && (
          <div className="flex gap-2" data-testid="tuya-chat-loading">
            <div className="w-7 h-7 rounded-md bg-muted grid place-items-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
            <div className="rounded-md px-3 py-2 text-sm bg-card border border-border text-muted-foreground italic">
              Pensando…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-2 p-2 border-t border-border bg-background"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ej: Apaga el aire de la oficina, programa el sala a las 8am…"
          disabled={sending}
          className="flex-1"
          data-testid="tuya-chat-input"
        />
        <Button type="submit" disabled={sending || !input.trim()} data-testid="tuya-chat-send">
          <Send className="w-4 h-4 mr-1" /> Enviar
        </Button>
      </form>
    </div>
  );
}
