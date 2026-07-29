import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Boxes, Users } from "lucide-react";
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

const napIcon = new L.DivIcon({
  html: `<div style="background:hsl(210 100% 55%);width:14px;height:14px;border-radius:3px;border:2px solid #fff;box-shadow:0 0 0 2px hsl(210 100% 55% / .3);"></div>`,
  className: "", iconSize: [14,14], iconAnchor: [7,7],
});

export default function NapMap() {
  const [naps, setNaps] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const [n, c] = await Promise.all([api.get("/nap-boxes"), api.get("/clients")]);
    setNaps(n.data); setClients(c.data);
  };
  useEffect(()=>{ load(); }, []);

  const center = useMemo(() => {
    if (naps.length) return [naps[0].lat, naps[0].lng];
    return [19.4326, -99.1332]; // CDMX default
  }, [naps]);

  const napFields = [
    { name:"name", label:"Nombre", required:true, full:true },
    { name:"lat", label:"Latitud", type:"number", required:true },
    { name:"lng", label:"Longitud", type:"number", required:true },
    { name:"capacity", label:"Capacidad", type:"number", required:true },
    { name:"address", label:"Dirección", full:true },
    { name:"notes", label:"Notas", type:"textarea", full:true },
  ];

  const save = async (v) => {
    try { await api.post("/nap-boxes", v); toast.success("Caja NAP creada"); await load(); }
    catch(e){ toast.error(formatApiError(e)); throw e; }
  };

  const countInNap = (id) => clients.filter(c=>c.nap_box_id===id).length;

  return (
    <div>
      <PageHeader title="Mapa NAP" subtitle="Ubicación de cajas NAP y clientes conectados. Capacidad y llenado en tiempo real."
        actions={<Button data-testid="new-nap-btn" onClick={()=>setOpen(true)}><Plus className="w-4 h-4 mr-1"/>Nueva NAP</Button>} />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded-md border border-border bg-card overflow-hidden" style={{ height: 560 }}>
          <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; OpenStreetMap · <a href="https://www.stadiamaps.com/">Stadia</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
            />
            {naps.map(n=>(
              <Marker key={n.id} position={[n.lat, n.lng]} icon={napIcon}>
                <Popup>
                  <div className="font-medium">{n.name}</div>
                  <div className="text-xs">{n.address}</div>
                  <div className="text-xs">Ocupación: {countInNap(n.id)}/{n.capacity}</div>
                </Popup>
              </Marker>
            ))}
            {clients.filter(c=>c.lat && c.lng).map(c=>(
              <CircleMarker key={c.id} center={[c.lat, c.lng]} radius={5}
                pathOptions={{ color: c.status==="active" ? "hsl(142 71% 45%)" : c.status==="suspended" ? "hsl(0 84% 60%)" : "hsl(43 85% 55%)", fillOpacity: 0.9 }}>
                <Popup><div className="font-medium">{c.full_name}</div><div className="text-xs">{c.address}</div></Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Cajas NAP</div>
          {naps.length===0 && <div className="text-sm text-muted-foreground">Aún no hay cajas NAP.</div>}
          {naps.map(n=>{
            const used = countInNap(n.id);
            const full = used >= n.capacity;
            return (
              <div key={n.id} className="rounded-md border border-border p-3 hover:bg-accent transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Boxes className="w-4 h-4 text-primary"/><div className="font-medium">{n.name}</div></div>
                  {full ? <Badge className="bg-red-500/10 text-red-400 border border-red-500/30" variant="outline">Llena</Badge>
                    : <Badge variant="outline"><Users className="w-3 h-3 mr-1"/>{used}/{n.capacity}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{n.address}</div>
                <div className="mt-2 h-1.5 rounded bg-secondary overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (used/n.capacity)*100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <FormDialog open={open} onOpenChange={setOpen} title="Nueva Caja NAP"
        fields={napFields} initial={{capacity:16}} onSubmit={save} />
    </div>
  );
}
