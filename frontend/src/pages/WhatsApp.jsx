import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageCircle, Inbox, Bot } from "lucide-react";
import { toast } from "sonner";

export default function WhatsApp() {
  const [params] = useSearchParams();
  const preselectClient = params.get("client");
  const [messages, setMessages] = useState([]);
  const [clients, setClients] = useState([]);
  const [activePhone, setActivePhone] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("chat");

  const load = async () => {
    const [m, c] = await Promise.all([api.get("/whatsapp/messages"), api.get("/clients")]);
    setMessages(m.data); setClients(c.data);
  };

  useEffect(()=>{ load(); }, []);

  useEffect(()=>{
    if (preselectClient && clients.length){
      const c = clients.find(x=>x.id===preselectClient);
      if (c?.phone) setActivePhone(c.phone);
    }
  }, [preselectClient, clients]);

  const conversations = useMemo(()=>{
    const map = new Map();
    messages.forEach(m=>{
      if (!map.has(m.phone)) map.set(m.phone, []);
      map.get(m.phone).push(m);
    });
    return Array.from(map.entries()).map(([phone, msgs])=>{
      const client = clients.find(c=>c.phone===phone);
      const last = msgs[0];
      return { phone, client, last, count: msgs.length };
    }).sort((a,b)=>b.last.created_at.localeCompare(a.last.created_at));
  }, [messages, clients]);

  const activeMessages = messages.filter(m=>m.phone===activePhone).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const activeClient = clients.find(c=>c.phone===activePhone);

  const send = async () => {
    if (!activePhone || !body.trim()) return;
    try {
      await api.post("/whatsapp/messages", {
        client_id: activeClient?.id, phone: activePhone, body, direction: "outgoing", kind
      });
      setBody(""); toast.success("Mensaje encolado (simulado)"); await load();
    } catch(e){ toast.error(formatApiError(e)); }
  };

  const simulateIncoming = async () => {
    if (!activePhone) return;
    await api.post("/whatsapp/simulate-incoming", {
      client_id: activeClient?.id, phone: activePhone, body: "Hola, tengo problemas con internet.", direction: "incoming", kind: "chat"
    });
    toast("Entrante simulado");
    await load();
  };

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        subtitle="Bandeja secundaria y recordatorios. Los mensajes se guardan como cola simulada — conecta tu proveedor cuando quieras."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-14rem)]">
        {/* Conversations */}
        <div className="rounded-md border border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <Inbox className="w-4 h-4 text-muted-foreground" />
            <div className="text-sm font-medium">Conversaciones</div>
            <Badge variant="outline" className="ml-auto font-mono text-xs">{conversations.length}</Badge>
          </div>
          <ScrollArea className="flex-1">
            {conversations.length===0 && <div className="p-4 text-sm text-muted-foreground">Sin mensajes aún.</div>}
            {conversations.map(({phone, client, last, count})=>(
              <button key={phone} onClick={()=>setActivePhone(phone)}
                data-testid={`conv-${phone}`}
                className={`w-full text-left p-3 border-b border-border hover:bg-accent transition-colors ${activePhone===phone?"bg-accent":""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-medium text-sm">{client?.full_name || phone}</div>
                    <div className="text-xs text-muted-foreground font-mono">{phone}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{count}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground truncate">{last.body}</div>
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Chat */}
        <div className="lg:col-span-2 rounded-md border border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <div className="text-sm font-medium">{activeClient?.full_name || activePhone || "Selecciona una conversación"}</div>
            {activePhone && <div className="text-xs text-muted-foreground font-mono ml-2">{activePhone}</div>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={simulateIncoming} disabled={!activePhone} data-testid="simulate-incoming"><Bot className="w-3 h-3 mr-1"/>Simular entrante</Button>
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            {activeMessages.length===0 && <div className="text-sm text-muted-foreground">Sin mensajes en esta conversación.</div>}
            <div className="space-y-2">
              {activeMessages.map(m=>(
                <div key={m.id} className={`max-w-[75%] rounded-md p-2.5 text-sm ${m.direction==="outgoing" ? "bg-primary/10 border border-primary/30 ml-auto" : "bg-secondary border border-border"}`}>
                  <div>{m.body}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                    <span>{m.kind}</span>
                    <span>{m.created_at.slice(11,16)}</span>
                    <span>{m.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t border-border p-3 space-y-2">
            <div className="flex gap-2">
              <Input placeholder="Teléfono (ej: +52...)" value={activePhone} onChange={(e)=>setActivePhone(e.target.value)} className="max-w-xs" data-testid="wa-phone"/>
              <select value={kind} onChange={(e)=>setKind(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="chat">Chat</option>
                <option value="reminder">Recordatorio</option>
                <option value="maintenance">Mantenimiento</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Textarea placeholder="Escribe un mensaje..." value={body} onChange={(e)=>setBody(e.target.value)} rows={2} data-testid="wa-body" />
              <Button onClick={send} data-testid="wa-send"><Send className="w-4 h-4"/></Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
