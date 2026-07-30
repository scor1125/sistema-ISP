import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, EmptyRow } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const methodLabel = {
  cash: "Efectivo", transfer: "Transferencia", stripe: "Stripe", other: "Otro"
};

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const preselectClient = params.get("client");
  const initialTab = params.get("tab") === "promises" ? "promises" : "all";
  const [tab, setTab] = useState(initialTab);
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = params.get("tab");
    if (t === "promises" && tab !== "promises") setTab("promises");
  }, [params, tab]);

  const load = async () => {
    const [p, c] = await Promise.all([api.get("/payments"), api.get("/clients")]);
    setItems(p.data); setClients(c.data);
  };
  useEffect(()=>{ load(); if (preselectClient) setOpen(true); }, [preselectClient]);

  const fields = [
    { name: "client_id", label: "Cliente", type: "select", required: true, full: true,
      options: clients.map(c=>({value:c.id,label:c.full_name}))},
    { name: "amount", label: "Monto", type: "number", required: true },
    { name: "method", label: "Método", type: "select", required: true,
      options: Object.entries(methodLabel).map(([v,l])=>({value:v,label:l})) },
    { name: "concept", label: "Concepto", full: true },
    { name: "invoice_number", label: "Nº Factura" },
    { name: "is_promise", label: "¿Promesa de pago?", type: "select",
      options: [{value:"false",label:"No"},{value:"true",label:"Sí"}] },
    { name: "promise_date", label: "Fecha promesa (YYYY-MM-DD)" },
    { name: "notes", label: "Notas", type: "textarea", full: true },
  ];

  const save = async (v) => {
    try {
      const payload = { ...v, is_promise: String(v.is_promise) === "true" };
      await api.post("/payments", payload);
      toast.success("Pago registrado"); await load();
    } catch(e){ toast.error(formatApiError(e)); throw e; }
  };

  const remove = async (id) => { if(window.confirm("¿Eliminar pago?")){ await api.delete(`/payments/${id}`); load(); } };

  const filter = (kind) => items.filter(i => {
    if (kind==="promises") return i.is_promise;
    if (kind==="all") return true;
    return !i.is_promise && i.method === kind;
  });

  const renderTable = (list) => (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Fecha</TableHead><TableHead>Cliente</TableHead>
          <TableHead>Monto</TableHead><TableHead>Método</TableHead>
          <TableHead>Concepto</TableHead><TableHead>Factura</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {list.length===0 && <EmptyRow colSpan={7} />}
          {list.map(p=>{
            const client = clients.find(c=>c.id===p.client_id);
            return (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.created_at.slice(0,10)}</TableCell>
                <TableCell>{client?.full_name || "—"}</TableCell>
                <TableCell className="font-mono">${p.amount}</TableCell>
                <TableCell><Badge variant="outline">{methodLabel[p.method] || p.method}</Badge></TableCell>
                <TableCell>{p.concept}{p.is_promise && <Badge className="ml-2 bg-amber-500/10 text-amber-400 border border-amber-500/30" variant="outline">Promesa · {p.promise_date}</Badge>}</TableCell>
                <TableCell className="font-mono text-xs">{p.invoice_number || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>remove(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Pagos"
        subtitle="Registra pagos en efectivo, transferencias, promesas y factura manual. Los pagos reactivan al cliente automáticamente."
        actions={<Button data-testid="new-payment-btn" onClick={()=>setOpen(true)}><Plus className="w-4 h-4 mr-1"/>Registrar pago</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => { setTab(v); const next = new URLSearchParams(params); if (v !== "all") next.set("tab", v); else next.delete("tab"); setParams(next, { replace: true }); }}>
        <TabsList data-testid="pay-tabs">
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="cash">Efectivo</TabsTrigger>
          <TabsTrigger value="transfer">Transferencia</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">{renderTable(filter("all"))}</TabsContent>
        <TabsContent value="cash" className="mt-4">{renderTable(filter("cash"))}</TabsContent>
        <TabsContent value="transfer" className="mt-4">{renderTable(filter("transfer"))}</TabsContent>
      </Tabs>

      <FormDialog open={open} onOpenChange={setOpen} title="Registrar pago"
        fields={fields}
        initial={{ client_id: preselectClient || "", method: "cash", concept: "Mensualidad", is_promise: false }}
        onSubmit={save} submitLabel="Registrar" />
    </div>
  );
}
