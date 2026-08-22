import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { planSpeedLabel } from "@/lib/utils";
import { PageHeader, EmptyRow, SearchBar, norm, PendingBadge } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, Zap } from "lucide-react";
import { toast } from "sonner";

export default function Plans() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

  const load = async () => setItems((await api.get("/plans")).data);
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return items;
    return items.filter((p) => norm(`${p.name} ${p.description} ${planSpeedLabel(p)} ${p.price}`).includes(nq));
  }, [items, q]);

  const fields = [
    { name: "name", label: "Nombre", required: true, full: true },
    { name: "upload_mbps", label: "Máx. subida (Mbps)", type: "number", required: true },
    { name: "download_mbps", label: "Máx. bajada (Mbps)", type: "number", required: true },
    { name: "price", label: "Precio mensual", type: "number", required: true },
    { name: "install_price", label: "Precio de instalación", type: "number" },
    { name: "description", label: "Descripción", type: "textarea", full: true },

    { name: "burst_enabled", label: "Ráfaga de velocidad (burst)", type: "select",
      options: [{ value: "true", label: "Habilitada" }, { value: "false", label: "Deshabilitada" }],
    },
    { name: "burst_upload_mbps", label: "Ráfaga subida (Mbps)", type: "number",
      hidden: (v) => String(v.burst_enabled) !== "true",
    },
    { name: "burst_download_mbps", label: "Ráfaga bajada (Mbps)", type: "number",
      hidden: (v) => String(v.burst_enabled) !== "true",
    },
    { name: "burst_threshold_percent", label: "Umbral de ráfaga (%)", type: "number",
      hidden: (v) => String(v.burst_enabled) !== "true",
      placeholder: "80",
    },
    { name: "burst_time_seconds", label: "Ventana de cálculo (segundos)", type: "number",
      hidden: (v) => String(v.burst_enabled) !== "true",
      placeholder: "8",
    },

    { name: "active", label: "Activo", type: "select", options: [{value:"true",label:"Sí"},{value:"false",label:"No"}] },
  ];

  const save = async (v) => {
    try {
      const payload = {
        ...v,
        active: String(v.active) !== "false",
        burst_enabled: String(v.burst_enabled) === "true",
        upload_mbps: Number(v.upload_mbps) || 0,
        download_mbps: Number(v.download_mbps) || 0,
        install_price: Number(v.install_price) || 0,
      };
      if (payload.burst_enabled) {
        payload.burst_upload_mbps = Number(v.burst_upload_mbps) || null;
        payload.burst_download_mbps = Number(v.burst_download_mbps) || null;
        payload.burst_threshold_percent = Number(v.burst_threshold_percent) || 80;
        payload.burst_time_seconds = Number(v.burst_time_seconds) || 8;
      }
      if (editing) await api.patch(`/plans/${editing.id}`, payload);
      else await api.post("/plans", payload);
      toast.success("Guardado"); setEditing(null); await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };
  const del = async (id) => { if (window.confirm("¿Eliminar?")) { await api.delete(`/plans/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Planes" subtitle="Los paquetes de internet que ofreces a tus clientes."
        actions={<Button data-testid="new-plan-btn" onClick={()=>{ setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1"/>Nuevo plan</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre, velocidad, precio o descripción…"
        hint={`${filtered.length} / ${items.length}`} testId="plans-search" />
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Velocidad</TableHead>
            <TableHead>Precio</TableHead><TableHead>Instalación</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length===0 && <EmptyRow colSpan={6} text={items.length===0 ? "Sin planes. Crea el primero." : "Nada coincide con la búsqueda."} />}
            {filtered.map(p=>(
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium flex items-center gap-2">{p.name}<PendingBadge row={p} /></div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <div>{planSpeedLabel(p)}</div>
                  {p.burst_enabled && (
                    <Badge variant="outline" className="mt-1 text-[10px] border-amber-500/40 text-amber-500">
                      <Zap className="w-2.5 h-2.5 mr-1" /> ráfaga {p.burst_upload_mbps}↑/{p.burst_download_mbps}↓
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono">${p.price}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.install_price ? `$${p.install_price}` : "—"}
                </TableCell>
                <TableCell>{p.active !== false ? <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" variant="outline">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={()=>{ setEditing(p); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={()=>del(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={open} onOpenChange={(v)=>{ setOpen(v); if(!v) setEditing(null); }}
        title={editing ? "Editar plan" : "Nuevo plan"} fields={fields}
        initial={editing
          ? { ...editing, active: editing.active !== false, burst_enabled: !!editing.burst_enabled }
          : { active: true, burst_enabled: false, burst_threshold_percent: 80, burst_time_seconds: 8 }}
        onSubmit={save} size="xl" />
    </div>
  );
}
