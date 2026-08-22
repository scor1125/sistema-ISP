import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Boxes, Users, Pencil, Trash2 } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from "react-leaflet";
import L from "leaflet";
import { toast } from "sonner";

// Fix leaflet default icon in bundler
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const NAP_ICON = new L.DivIcon({
  html: `<div style="background:hsl(210 100% 55%);width:14px;height:14px;border-radius:3px;border:2px solid #fff;box-shadow:0 0 0 2px hsl(210 100% 55% / .3);"></div>`,
  className: "", iconSize: [14, 14], iconAnchor: [7, 7],
});

const DEFAULT_CENTER = [19.4326, -99.1332]; // CDMX
const MAP_STYLE = { height: "100%", width: "100%" };
const STATUS_COLOR = {
  active: "hsl(142 71% 45%)",
  suspended: "hsl(0 84% 60%)",
  offline: "hsl(43 85% 55%)",
  new: "hsl(210 100% 55%)",
};

const NAP_FIELDS = [
  { name: "name", label: "Nombre", required: true, full: true },
  { name: "port_type", label: "Tipo de caja", type: "select", required: true,
    options: [
      { value: "1x8", label: "1x8 (8 clientes máximo)" },
      { value: "1x16", label: "1x16 (16 clientes máximo)" },
    ],
  },
  { name: "lat", label: "Latitud", type: "number", required: true },
  { name: "lng", label: "Longitud", type: "number", required: true },
  { name: "address", label: "Dirección", full: true },
  { name: "notes", label: "Notas", type: "textarea", full: true },
];

const INITIAL_NAP = { port_type: "1x16" };

export default function NapMap() {
  const [naps, setNaps] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [n, c] = await Promise.all([api.get("/nap-boxes"), api.get("/clients")]);
    setNaps(n.data); setClients(c.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredNaps = useMemo(() => {
    const nq = norm(q); if (!nq) return naps;
    return naps.filter((n) => norm(`${n.name} ${n.address} ${n.notes}`).includes(nq));
  }, [naps, q]);

  const center = useMemo(() => {
    if (naps.length) return [naps[0].lat, naps[0].lng];
    return DEFAULT_CENTER;
  }, [naps]);

  // Count clients per NAP once per (clients, naps) change.
  const countByNap = useMemo(() => {
    const acc = {};
    clients.forEach((c) => {
      if (!c.nap_box_id) return;
      acc[c.nap_box_id] = (acc[c.nap_box_id] || 0) + 1;
    });
    return acc;
  }, [clients]);

  const mappedClients = useMemo(
    () => clients.filter((c) => c.lat && c.lng),
    [clients],
  );

  const save = async (v) => {
    try {
      if (editing) {
        await api.patch(`/nap-boxes/${editing.id}`, v);
        toast.success("Caja NAP actualizada");
      } else {
        await api.post("/nap-boxes", v);
        toast.success("Caja NAP creada");
      }
      setEditing(null); await load();
    }
    catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const removeNap = async (id) => {
    if (!window.confirm("¿Eliminar esta caja NAP?")) return;
    try { await api.delete(`/nap-boxes/${id}`); toast.success("Eliminada"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader title="Mapa NAP" subtitle="Ubicación de cajas NAP y clientes conectados. Capacidad y llenado en tiempo real."
        actions={<Button data-testid="new-nap-btn" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />Nueva NAP</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar cajas NAP por nombre, dirección o notas…"
        hint={`${filteredNaps.length} / ${naps.length}`} testId="nap-search" />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded-md border border-border bg-card overflow-hidden" style={{ height: 560 }}>
          <MapContainer center={center} zoom={13} style={MAP_STYLE}>
            <TileLayer
              attribution='&copy; OpenStreetMap · <a href="https://www.stadiamaps.com/">Stadia</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
            />
            {naps.map((n) => (
              <Marker key={n.id} position={[n.lat, n.lng]} icon={NAP_ICON}>
                <Popup>
                  <div className="font-medium">{n.name}</div>
                  <div className="text-xs">{n.address}</div>
                  <div className="text-xs">Ocupación: {countByNap[n.id] || 0}/{n.port_type === "1x8" ? 8 : (n.port_type === "1x16" ? 16 : (n.capacity || 16))} ({n.port_type || "1x16"})</div>
                </Popup>
              </Marker>
            ))}
            {mappedClients.map((c) => (
              <ClientDot key={c.id} client={c} />
            ))}
          </MapContainer>
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 560 }}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Cajas NAP</div>
          {filteredNaps.length === 0 && <div className="text-sm text-muted-foreground">{naps.length === 0 ? "Aún no hay cajas NAP." : "Nada coincide con la búsqueda."}</div>}
          {filteredNaps.map((n) => {
            const used = countByNap[n.id] || 0;
            const cap = n.port_type === "1x8" ? 8 : (n.port_type === "1x16" ? 16 : (n.capacity || 16));
            const full = used >= cap;
            const empty = used === 0;
            const statusBadge = full
              ? <Badge className="bg-red-500/15 text-red-300 border-red-500/40" variant="outline">Llena</Badge>
              : empty
                ? <Badge className="bg-slate-500/10 text-slate-300 border-slate-500/40" variant="outline">Vacía</Badge>
                : <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/40"><Users className="w-3 h-3 mr-1" />{used}/{cap}</Badge>;
            return (
              <div key={n.id} className="rounded-md border border-border p-3 hover:bg-accent transition-colors" data-testid={`nap-card-${n.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Boxes className="w-4 h-4 text-primary shrink-0" />
                    <div className="font-medium truncate">{n.name}</div>
                    <Badge variant="outline" className="text-[9px] font-mono px-1">{n.port_type || "1x16"}</Badge>
                  </div>
                  {statusBadge}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{n.address}</div>
                <div className="mt-2 h-1.5 rounded bg-secondary overflow-hidden">
                  <div className={`h-full ${full ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
                </div>
                <div className="mt-2 flex gap-1 justify-end">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(n); setOpen(true); }} data-testid={`nap-edit-${n.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeNap(n.id)} data-testid={`nap-del-${n.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <FormDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        title={editing ? "Editar Caja NAP" : "Nueva Caja NAP"}
        fields={NAP_FIELDS} initial={editing || INITIAL_NAP} onSubmit={save} />
    </div>
  );
}

// Extracted dot component so its pathOptions object is stable per-client render.
function ClientDot({ client }) {
  const color = STATUS_COLOR[client.status] || STATUS_COLOR.new;
  const pathOptions = useMemo(() => ({ color, fillOpacity: 0.9 }), [color]);
  return (
    <CircleMarker center={[client.lat, client.lng]} radius={5} pathOptions={pathOptions}>
      <Popup><div className="font-medium">{client.full_name}</div><div className="text-xs">{client.address}</div></Popup>
    </CircleMarker>
  );
}
