import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, EmptyRow, SearchBar, norm } from "@/components/Common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Disconnected() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const nav = useNavigate();

  useEffect(()=>{
    (async ()=>{
      const { data } = await api.get("/disconnected");
      setItems(data);
    })();
  }, []);

  const filtered = useMemo(() => {
    const nq = norm(q); if (!nq) return items;
    return items.filter((c) => norm(`${c.full_name} ${c.phone} ${c.ip_address} ${c.community} ${c.address}`).includes(nq));
  }, [items, q]);

  const openWhatsApp = (client) => nav(`/whatsapp?client=${client.id}`);

  return (
    <div>
      <PageHeader
        title="Desconectados"
        subtitle="Clientes offline por más de 30 min (configurable). Envía WhatsApp con un click."
      />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, teléfono, IP o comunidad…"
        hint={`${filtered.length} / ${items.length}`} testId="disc-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>Teléfono</TableHead>
            <TableHead>IP</TableHead><TableHead>Última conexión</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length===0 && <EmptyRow colSpan={6} text={items.length===0 ? "Ningún cliente desconectado en este momento." : "Nada coincide con la búsqueda."} />}
            {filtered.map(c=>(
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.full_name}</TableCell>
                <TableCell className="font-mono text-xs">{c.phone || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{c.ip_address || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{c.last_seen ? c.last_seen.slice(0,16).replace("T"," ") : "—"}</TableCell>
                <TableCell><Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10"><WifiOff className="w-3 h-3 mr-1"/>Offline</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={()=>openWhatsApp(c)} data-testid={`wa-${c.id}`}><MessageCircle className="w-4 h-4 mr-1"/>WhatsApp</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
