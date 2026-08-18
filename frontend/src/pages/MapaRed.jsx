import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Boxes, Cable, Ruler, Download, Trash2, MapPin, Copy,
  MousePointer2, Waypoints, Server, Signal, Zap, Settings2, KeyRound,
  CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight,
  Users as UsersIcon, Package, Anchor, Archive, GitCommitVertical,
  GripVertical, ChevronsUpDown, ChevronsLeftRight, Maximize2, Minimize2,
  Layers, Link2, Pencil, Plus,
} from "lucide-react";
import { toast } from "sonner";

/* ============================================================
   TIA-598 fiber color code (up to 24 strands)
   ============================================================ */
const TIA598 = [
  { pos: 1,  name: "Azul",         hex: "#1e90ff" },
  { pos: 2,  name: "Naranja",      hex: "#ff8c00" },
  { pos: 3,  name: "Verde",        hex: "#22c55e" },
  { pos: 4,  name: "Marrón",       hex: "#a0522d" },
  { pos: 5,  name: "Pizarra",      hex: "#708090" },
  { pos: 6,  name: "Blanco",       hex: "#ffffff" },
  { pos: 7,  name: "Rojo",         hex: "#ef4444" },
  { pos: 8,  name: "Negro",        hex: "#111111" },
  { pos: 9,  name: "Amarillo",     hex: "#eab308" },
  { pos: 10, name: "Violeta",      hex: "#a855f7" },
  { pos: 11, name: "Rosa",         hex: "#ec4899" },
  { pos: 12, name: "Aguamarina",   hex: "#06b6d4" },
];
function tia598Slice(n) { return TIA598.slice(0, Math.min(n || 12, 12)); }

/* ============================================================
   Marker icon factory — SVG data-URL with baked-in label
   (Google Maps symbol-path icons don't render labels reliably,
    so we render our own circle + letter + name text into an SVG)
   ============================================================ */
function makeMarkerIcon(google, opts) {
  const size = opts.size || 44;
  const half = size / 2;
  const letterMap = {
    nap: "N", splice: "E", pole: "P", reserve: "R",
    olt_map: "O", odf: "F", client: "C",
  };
  const letter = letterMap[opts.type] || "?";
  const name = String(opts.name || "").slice(0, 22)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const color = opts.color || "#3b82f6";
  const totalH = size + (name ? 20 : 0);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size + 60}' height='${totalH}'>
    <g transform='translate(30 0)'>
      <circle cx='${half}' cy='${half}' r='${half - 3}' fill='${color}' stroke='white' stroke-width='3'/>
      <text x='${half}' y='${half + 6}' font-family='ui-monospace, Menlo, monospace' font-size='18' fill='white' font-weight='700' text-anchor='middle'>${letter}</text>
    </g>
    ${name ? `<text x='${(size + 60) / 2}' y='${size + 15}' font-family='ui-monospace, Menlo, monospace' font-size='11' fill='white' stroke='black' stroke-width='2.5' paint-order='stroke' font-weight='700' text-anchor='middle'>${name}</text>` : ""}
  </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size + 60, totalH),
    anchor: new google.maps.Point((size + 60) / 2, half),
  };
}

/* ============================================================
   Node & cable style catalog
   ============================================================ */
const CABLE_STYLES = {
  troncal:      { color: "#00d26a", weight: 6, label: "Troncal" },
  distribucion: { color: "#ef4444", weight: 4, label: "Distribución" },
  drop:         { color: "#eab308", weight: 2, label: "Drop / Cliente" },
};

const NAP_CAPS = [
  { value: "1x2",  label: "1:2 (2 puertos)",   ports: 2 },
  { value: "1x4",  label: "1:4 (4 puertos)",   ports: 4 },
  { value: "1x8",  label: "1:8 (8 puertos)",   ports: 8 },
  { value: "1x16", label: "1:16 (16 puertos)", ports: 16 },
  { value: "1x32", label: "1:32 (32 puertos)", ports: 32 },
];

const NODE_TYPES = {
  nap:       { label: "Caja NAP",     icon: Boxes,             color: "#ef4444" },
  splice:    { label: "Empalme",      icon: GitCommitVertical, color: "#a855f7" },
  pole:      { label: "Poste",        icon: Anchor,            color: "#0ea5e9" },
  reserve:   { label: "Reserva",      icon: Archive,           color: "#f59e0b" },
  olt_map:   { label: "OLT (mapa)",   icon: Server,            color: "#3b82f6" },
  odf:       { label: "ODF",          icon: Layers,            color: "#06b6d4" },
  client:    { label: "Cliente",      icon: UsersIcon,         color: "#22c55e" },
  cable:     { label: "Cable",        icon: Cable,             color: "#0ea5e9" },
  pan:       { label: "Mover",        icon: MousePointer2,     color: "#94a3b8" },
};

const OLT_BRANDS = ["V-Sol", "Huawei", "ZTE", "Fiberhome", "C-Data", "BDCOM", "Nokia", "Otro"];
const OLT_TECH = ["gpon", "epon"];

/* ============================================================
   Default map center — Xicoténcatl (17°30'58.9"N 92°42'13.5"W).
   User's operations base; maps always open here on first load.
   ============================================================ */
const DEFAULT_CENTER = { lat: 17.516359, lng: -92.703755 };
const DEFAULT_ZOOM = 17;

/* ============================================================
   Google Maps loader
   ============================================================ */
const GOOGLE_MAPS_KEY_ENV = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
let _mapsPromise = null;
let _mapsPromiseKey = null;
function loadGoogleMaps(apiKey) {
  const key = apiKey || GOOGLE_MAPS_KEY_ENV;
  if (window.google?.maps?.geometry) return Promise.resolve(window.google);
  if (_mapsPromise && _mapsPromiseKey === key) return _mapsPromise;
  _mapsPromiseKey = key;
  _mapsPromise = new Promise((resolve, reject) => {
    if (!key) { reject(new Error("Falta la API key de Google Maps")); return; }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=drawing,geometry&v=weekly`;
    s.async = true; s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

/* ============================================================
   Utils
   ============================================================ */
const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const km = (m) => (Number(m || 0) / 1000).toFixed(3);
const alphaLabel = (i) => {
  // A, B, C… Z, AA, AB…
  let s = ""; let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};

/* ============================================================
   TIA-598 legend chip
   ============================================================ */
function Tia598Legend({ count }) {
  const slice = tia598Slice(count);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {slice.map((f) => (
        <div key={f.pos} className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-black/20 border border-slate-700"
             title={`Hilo ${f.pos} · ${f.name}`}>
          <span className="w-2.5 h-2.5 rounded-full border border-slate-500"
                style={{ background: f.hex }} />
          <span className="text-[10px] font-mono text-slate-300">{f.pos}·{f.name.slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Unified "New element" dialog with dynamic form per type
   ============================================================ */
function NewElementDialog({ open, onOpenChange, coords, initialType, onSaved }) {
  const [type, setType] = useState(initialType || "nap");
  const [f, setF] = useState({});

  useEffect(() => {
    if (!open) return;
    setType(initialType || "nap");
    setF({});
  }, [open, initialType]);

  const submit = async () => {
    if (!f.name?.trim() && type !== "client") return toast.error("El nombre es obligatorio");
    try {
      if (type === "nap") {
        const cap = NAP_CAPS.find((c) => c.value === (f.port_type || "1x16"));
        await api.post("/nap-boxes", {
          name: f.name.trim(),
          lat: coords.lat, lng: coords.lng,
          port_type: f.port_type || "1x16",
          used_ports: Math.max(0, Math.min(cap.ports, Number(f.used_ports || 0))),
          color: f.color || "#ef4444",
          notes: f.notes || "",
        });
        toast.success(`NAP "${f.name}" creada`);
      } else if (type === "client") {
        if (!f.full_name?.trim()) return toast.error("El nombre del cliente es obligatorio");
        await api.post("/clients", {
          full_name: f.full_name.trim(),
          phone: f.phone || "",
          email: f.email || "",
          address: f.address || "",
          lat: coords.lat, lng: coords.lng,
          payment_day: Number(f.payment_day) || 1,
        });
        toast.success(`Cliente "${f.full_name}" creado`);
      } else if (type === "olt_map") {
        await api.post("/map/nodes", {
          type: "olt_map",
          name: f.name.trim(),
          lat: coords.lat, lng: coords.lng,
          color: f.color || "#3b82f6",
          notes: f.notes || "",
          data: {
            technology: f.technology || "gpon",
            brand: f.brand || "V-Sol",
            model: f.model || "",
            ports: Number(f.ports) || 8,
          },
        });
        toast.success(`OLT "${f.name}" agregado al mapa`);
      } else if (type === "odf") {
        const cap = Number(f.capacity || 12);
        const ports = Array.from({ length: cap }, (_, i) => ({
          position: i + 1,
          name: (f.odf_ports?.[i]?.name || "").trim() || `Puerto ${i + 1}`,
        }));
        await api.post("/map/nodes", {
          type: "odf",
          name: f.name.trim(),
          lat: coords.lat, lng: coords.lng,
          color: f.color || NODE_TYPES.odf.color,
          notes: f.notes || "",
          data: { capacity: cap, ports },
        });
        toast.success(`ODF "${f.name}" (${cap} fibras · ${ports.length} puertos) agregado`);
      } else {
        await api.post("/map/nodes", {
          type,
          name: f.name.trim(),
          lat: coords.lat, lng: coords.lng,
          color: f.color || NODE_TYPES[type]?.color,
          notes: f.notes || "",
          data: type === "reserve" ? { reserve_m: Number(f.reserve_m || 0) }
              : type === "splice"  ? { fibers_count: Number(f.fibers_count || 12) }
              : type === "pole"    ? { material: f.material || "concreto", height_m: Number(f.height_m || 8) }
              : {},
        });
        toast.success(`${NODE_TYPES[type].label} "${f.name}" agregado`);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Anclar nuevo elemento
          </DialogTitle>
          {coords && (
            <DialogDescription className="font-mono text-xs">
              📍 {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Type picker cards */}
        <div>
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">Tipo de estructura</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {["nap", "splice", "pole", "reserve", "olt_map", "odf", "client"].map((k) => {
              const Icon = NODE_TYPES[k].icon;
              const active = type === k;
              return (
                <button
                  key={k}
                  onClick={() => setType(k)}
                  data-testid={`node-type-${k}`}
                  className={`rounded-md border p-2 text-center transition-colors ${
                    active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: NODE_TYPES[k].color }} />
                  <div className="text-[11px] font-mono">{NODE_TYPES[k].label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic form */}
        <div className="space-y-3 pt-2">
          {type !== "client" && (
            <div>
              <Label className="text-xs">Nombre</Label>
              <Input data-testid="new-el-name" value={f.name || ""} autoFocus
                onChange={(e) => setF({ ...f, name: e.target.value })}
                placeholder={type === "nap" ? "Ej: NAP-01 Reforma" : `${NODE_TYPES[type].label} 01`} />
            </div>
          )}

          {type === "nap" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Capacidad</Label>
                <Select value={f.port_type || "1x16"} onValueChange={(v) => setF({ ...f, port_type: v })}>
                  <SelectTrigger data-testid="nap-cap"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NAP_CAPS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Puertos ocupados</Label>
                <Input type="number" min="0" data-testid="nap-used"
                  value={f.used_ports ?? 0}
                  onChange={(e) => setF({ ...f, used_ports: e.target.value })} />
              </div>
            </div>
          )}

          {type === "splice" && (
            <div>
              <Label className="text-xs">Cantidad de hilos empalmados (TIA-598)</Label>
              <Select value={String(f.fibers_count || 12)} onValueChange={(v) => setF({ ...f, fibers_count: Number(v) })}>
                <SelectTrigger data-testid="splice-fibers"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[6, 8, 12, 24].map((n) => <SelectItem key={n} value={String(n)}>{n} hilos</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "reserve" && (
            <div>
              <Label className="text-xs">Metros de reserva</Label>
              <Input type="number" min="0" step="0.1" data-testid="reserve-m"
                value={f.reserve_m || ""}
                onChange={(e) => setF({ ...f, reserve_m: e.target.value })}
                placeholder="Ej: 15" />
            </div>
          )}

          {type === "pole" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Material</Label>
                <Select value={f.material || "concreto"} onValueChange={(v) => setF({ ...f, material: v })}>
                  <SelectTrigger data-testid="pole-mat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="madera">Madera</SelectItem>
                    <SelectItem value="concreto">Concreto</SelectItem>
                    <SelectItem value="metal">Metal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Altura (m)</Label>
                <Input type="number" min="0" step="0.5" data-testid="pole-h"
                  value={f.height_m || ""}
                  onChange={(e) => setF({ ...f, height_m: e.target.value })}
                  placeholder="8" />
              </div>
            </div>
          )}

          {type === "olt_map" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tecnología</Label>
                  <Select value={f.technology || "gpon"} onValueChange={(v) => setF({ ...f, technology: v })}>
                    <SelectTrigger data-testid="olt-tech"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OLT_TECH.map((t) => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Marca</Label>
                  <Select value={f.brand || "V-Sol"} onValueChange={(v) => setF({ ...f, brand: v })}>
                    <SelectTrigger data-testid="olt-brand"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OLT_BRANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Modelo (opcional)</Label>
                  <Input value={f.model || ""} onChange={(e) => setF({ ...f, model: e.target.value })}
                    placeholder="Ej: V1600D-24" />
                </div>
                <div>
                  <Label className="text-xs">Puertos PON</Label>
                  <Input type="number" min="1" data-testid="olt-ports"
                    value={f.ports || 8}
                    onChange={(e) => setF({ ...f, ports: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {type === "odf" && (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Capacidad de fibra</Label>
                <Select
                  value={String(f.capacity || 12)}
                  onValueChange={(v) => {
                    const cap = Number(v);
                    // Regenerate the ports array whenever capacity changes,
                    // preserving any names the user already typed.
                    const ports = Array.from({ length: cap }, (_, i) => ({
                      position: i + 1,
                      name: f.odf_ports?.[i]?.name || `Puerto ${i + 1}`,
                    }));
                    setF({ ...f, capacity: cap, odf_ports: ports });
                  }}
                >
                  <SelectTrigger data-testid="odf-cap"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 8, 12, 24].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} fibra{n === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">
                  Puertos virtuales · nombra cada uno ({Number(f.capacity || 12)} {Number(f.capacity || 12) === 1 ? "puerto" : "puertos"})
                </Label>
                <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1 mt-1 border border-border/40 rounded p-2 bg-black/10">
                  {Array.from({ length: Number(f.capacity || 12) }, (_, i) => {
                    const pos = i + 1;
                    const name = f.odf_ports?.[i]?.name ?? `Puerto ${pos}`;
                    return (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-primary shrink-0 w-6 text-right">
                          #{pos}
                        </span>
                        <Input
                          value={name}
                          onChange={(e) => {
                            const ports = [...(f.odf_ports || [])];
                            while (ports.length <= i) {
                              ports.push({
                                position: ports.length + 1,
                                name: `Puerto ${ports.length + 1}`,
                              });
                            }
                            ports[i] = { position: pos, name: e.target.value };
                            setF({ ...f, odf_ports: ports });
                          }}
                          placeholder={`Puerto ${pos}`}
                          className="h-7 text-xs font-mono px-1.5"
                          data-testid={`odf-port-${pos}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {type === "client" && (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Nombre completo</Label>
                <Input value={f.full_name || ""} autoFocus data-testid="client-name"
                  onChange={(e) => setF({ ...f, full_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Teléfono</Label>
                  <Input value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Dirección</Label>
                <Input value={f.address || ""} onChange={(e) => setF({ ...f, address: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Día de pago</Label>
                <Input type="number" min="1" max="28" value={f.payment_day || 1}
                  onChange={(e) => setF({ ...f, payment_day: e.target.value })} />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea rows={2} value={f.notes || ""}
              onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} data-testid="new-el-save">Anclar en el mapa</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Cable-type + fibers picker (shown after finishing a polyline)
   Supports: preset tipo, custom name, custom color, custom weight (1-10px)
   and fiber counts including 1-hilo drop cables.
   ============================================================ */
function CableTypeDialog({ open, onOpenChange, lengthM, onConfirm, initial }) {
  const [tipo, setTipo] = useState("distribucion");
  const [fibers, setFibers] = useState(12);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CABLE_STYLES.distribucion.color);
  const [weight, setWeight] = useState(CABLE_STYLES.distribucion.weight);
  // Track whether the user has manually tweaked color/weight so we don't
  // clobber their choice when they switch the "tipo" preset.
  const [customized, setCustomized] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      // Edit mode: hydrate from the existing cable so the user sees the
      // real current settings (name / tipo / fibers / color / weight).
      const t = initial.tipo || "distribucion";
      setTipo(t);
      setFibers(Number(initial.fibers_count) || 12);
      setName(initial.name || "");
      setColor(initial.color || CABLE_STYLES[t]?.color || CABLE_STYLES.distribucion.color);
      setWeight(Number(initial.weight) || CABLE_STYLES[t]?.weight || 3);
      setCustomized(true); // avoid the preset auto-overriding color/weight
    } else {
      setTipo("distribucion");
      setFibers(12);
      setName("");
      setColor(CABLE_STYLES.distribucion.color);
      setWeight(CABLE_STYLES.distribucion.weight);
      setCustomized(false);
    }
  }, [open, initial]);

  const chooseTipo = (k) => {
    setTipo(k);
    // If the user hasn't customized color/weight, snap to the preset defaults.
    if (!customized) {
      setColor(CABLE_STYLES[k].color);
      setWeight(CABLE_STYLES[k].weight);
    }
  };

  const FIBER_OPTIONS = [1, 6, 8, 12, 24];
  const isEdit = !!initial;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="w-4 h-4 text-primary" /> {isEdit ? "Editar cable" : "Nuevo cable"}
          </DialogTitle>
          <DialogDescription>
            Longitud calculada: <span className="font-mono text-primary">{lengthM.toFixed(2)} m</span> ({km(lengthM)} km)
            {isEdit && (
              <>
                <br />
                <span className="text-[10px] text-emerald-400">
                  Consejo: cierra este diálogo y en el mapa arrastra los vértices para mover puntos, arrastra los midpoints para agregar, o click-derecho sobre un vértice para eliminarlo.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Name */}
          <div>
            <Label className="text-xs mb-1 block">Nombre del cable</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Troncal Norte, Drop Cliente #12"
              data-testid="cable-name"
              autoFocus
            />
          </div>

          {/* Tipo de tendido */}
          <div>
            <Label className="text-xs mb-1 block">Tipo de tendido (preset)</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(CABLE_STYLES).map(([k, s]) => (
                <button
                  key={k}
                  onClick={() => chooseTipo(k)}
                  data-testid={`cable-tipo-${k}`}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    tipo === k ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="w-full rounded-full mb-2" style={{ background: s.color, height: `${s.weight}px` }} />
                  <div className="font-semibold text-sm">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground">{s.weight}px</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color + grosor custom */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs mb-1 block">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => { setColor(e.target.value); setCustomized(true); }}
                  className="w-14 h-9 p-0.5 cursor-pointer"
                  data-testid="cable-color"
                />
                <span className="text-xs font-mono text-muted-foreground">{color.toUpperCase()}</span>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Grosor (1-10 px)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="range"
                  min="1" max="10" step="1"
                  value={weight}
                  onChange={(e) => { setWeight(Number(e.target.value)); setCustomized(true); }}
                  className="flex-1"
                  data-testid="cable-weight"
                />
                <span className="text-xs font-mono text-primary w-8 text-right">{weight}px</span>
              </div>
            </div>
          </div>

          {/* Live preview line */}
          <div className="rounded-md border border-border/60 bg-black/20 p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Vista previa</div>
            <div className="w-full rounded-full" style={{ background: color, height: `${weight}px` }} />
          </div>

          {/* Fibers */}
          <div>
            <Label className="text-xs mb-1 block">Cantidad de hilos (TIA-598)</Label>
            <div className="grid grid-cols-5 gap-2">
              {FIBER_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setFibers(n)}
                  data-testid={`cable-fibers-${n}`}
                  className={`rounded-md border p-2 font-mono transition-colors ${
                    fibers === n ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  {n === 1 ? "1 hilo" : `${n} hilos`}
                </button>
              ))}
            </div>
            <div className="mt-2 rounded-md border border-border p-2 bg-muted/30">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
                Código de color · TIA-598 ({fibers} {fibers === 1 ? "hilo" : "hilos"})
              </div>
              <Tia598Legend count={fibers} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{isEdit ? "Cancelar" : "Descartar"}</Button>
          <Button
            onClick={() => onConfirm({ tipo, fibers, name: name.trim(), color, weight })}
            data-testid="cable-save"
          >
            {isEdit ? "Guardar cambios" : "Guardar cable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Floating TOOLBAR inside the map · DRAGGABLE + VERTICAL/HORIZONTAL
   Position + orientation persisted to localStorage so the layout
   survives reloads. Includes a custom fullscreen button that
   toggles fullscreen on the outer container so the drawing tools
   remain usable inside fullscreen.
   ============================================================ */
const TOOLBAR_POS_KEY = "mapaToolbarPos";
const TOOLBAR_ORIENT_KEY = "mapaToolbarOrient";

function MapToolbar({ mode, setMode, drawingVertexCount,
                     onFinishPolyline, onCancelPolyline,
                     containerEl }) {
  const tools = [
    { key: "pan",     icon: MousePointer2,     label: "Mover" },
    { key: "nap",     icon: Boxes,             label: "NAP" },
    { key: "splice",  icon: GitCommitVertical, label: "Empalme" },
    { key: "pole",    icon: Anchor,            label: "Poste" },
    { key: "reserve", icon: Archive,           label: "Reserva" },
    { key: "olt_map", icon: Server,            label: "OLT" },
    { key: "odf",     icon: Layers,            label: "ODF" },
    { key: "client",  icon: UsersIcon,         label: "Cliente" },
    { key: "cable",   icon: Cable,             label: "Cable" },
  ];

  const [orientation, setOrientation] = useState(() => {
    try { return localStorage.getItem(TOOLBAR_ORIENT_KEY) || "horizontal"; }
    catch { return "horizontal"; }
  });
  const [pos, setPos] = useState(() => {
    try {
      const raw = localStorage.getItem(TOOLBAR_POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [isFs, setIsFs] = useState(false);
  const barRef = useRef(null);

  // Persist changes
  useEffect(() => {
    try { localStorage.setItem(TOOLBAR_ORIENT_KEY, orientation); } catch {}
  }, [orientation]);
  useEffect(() => {
    if (pos == null) return;
    try { localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  // Track native fullscreen state so we can swap the icon.
  useEffect(() => {
    const handler = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const startDrag = (e) => {
    e.preventDefault();
    const bar = barRef.current;
    const container = bar?.parentElement;
    if (!bar || !container) return;
    const barRect = bar.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const startX = pos?.x ?? (barRect.left - containerRect.left);
    const startY = pos?.y ?? (barRect.top - containerRect.top);
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    const onMove = (m) => {
      const nx = startX + (m.clientX - startClientX);
      const ny = startY + (m.clientY - startClientY);
      const maxX = Math.max(0, containerRect.width - barRect.width);
      const maxY = Math.max(0, containerRect.height - barRect.height);
      setPos({
        x: Math.max(0, Math.min(maxX, nx)),
        y: Math.max(0, Math.min(maxY, ny)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Safety net: on mount, on orientation change, on window resize and on
  // fullscreen enter/exit, verify that the saved `pos` still lands inside
  // the current container bounds. If it doesn't (stale localStorage from a
  // previous session, orientation swap that changed toolbar dimensions, or
  // the user shrank their window), reset to the default centered-top layout
  // so the toolbar is always visible.
  useEffect(() => {
    if (!pos) return;
    const validate = () => {
      const bar = barRef.current;
      const container = bar?.parentElement;
      if (!bar || !container) return;
      const barRect = bar.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const maxX = Math.max(0, containerRect.width - barRect.width);
      const maxY = Math.max(0, containerRect.height - barRect.height);
      // Fully off-screen (or wider than the container) → hard reset
      if (pos.x < -20 || pos.y < -20 ||
          pos.x > containerRect.width - 40 ||
          pos.y > containerRect.height - 20 ||
          barRect.width > containerRect.width) {
        setPos(null);
        try { localStorage.removeItem(TOOLBAR_POS_KEY); } catch {}
        return;
      }
      // Partially off-screen → silent clamp
      if (pos.x > maxX || pos.y > maxY) {
        setPos({ x: Math.min(pos.x, maxX), y: Math.min(pos.y, maxY) });
      }
    };
    // Defer one frame so the newly-rendered toolbar has real dimensions
    const raf = requestAnimationFrame(validate);
    window.addEventListener("resize", validate);
    document.addEventListener("fullscreenchange", validate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", validate);
      document.removeEventListener("fullscreenchange", validate);
    };
  }, [pos, orientation]);

  const resetPos = () => {
    setPos(null);
    try { localStorage.removeItem(TOOLBAR_POS_KEY); } catch {}
    toast.success("Barra restaurada al centro superior");
  };

  const toggleOrient = () => {
    setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"));
  };

  const toggleFullscreen = () => {
    const target = containerEl || barRef.current?.parentElement;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      target.requestFullscreen().catch((e) => toast.error(`No se pudo abrir pantalla completa: ${e.message || e}`));
    }
  };

  const isVertical = orientation === "vertical";
  const style = pos ? { left: pos.x, top: pos.y } : { top: 12 };
  const centerClass = pos ? "" : "left-1/2 -translate-x-1/2";
  const layoutClass = isVertical ? "flex-col items-stretch" : "flex-row items-center";

  return (
    <div
      ref={barRef}
      className={`absolute z-30 flex ${layoutClass} gap-1 rounded-lg bg-slate-900/95 backdrop-blur px-2 py-1.5 border border-emerald-500/40 shadow-2xl ${centerClass}`}
      style={style}
      data-testid="map-toolbar"
      data-orientation={orientation}
    >
      {/* Drag handle · double-click to restore position */}
      <button
        onMouseDown={startDrag}
        onDoubleClick={resetPos}
        className={`cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-700/40 text-slate-400 hover:text-slate-200 ${isVertical ? "mb-1 self-center" : "mr-1"}`}
        title="Arrastra para mover · doble-click para restaurar"
        data-testid="toolbar-drag-handle"
      >
        <GripVertical className={`w-4 h-4 ${isVertical ? "" : "rotate-0"}`} />
      </button>

      {/* Orientation toggle */}
      <button
        onClick={toggleOrient}
        className={`p-1 rounded hover:bg-slate-700/40 text-slate-400 hover:text-emerald-300 ${isVertical ? "self-center" : ""}`}
        title={isVertical ? "Cambiar a horizontal" : "Cambiar a vertical"}
        data-testid="toolbar-rotate"
      >
        {isVertical ? <ChevronsLeftRight className="w-4 h-4" /> : <ChevronsUpDown className="w-4 h-4" />}
      </button>

      {/* Custom fullscreen button (so drawing tools remain usable in fullscreen) */}
      <button
        onClick={toggleFullscreen}
        className={`p-1 rounded hover:bg-slate-700/40 text-slate-400 hover:text-sky-300 ${isVertical ? "self-center" : ""}`}
        title={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
        data-testid="toolbar-fullscreen"
      >
        {isFs ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>

      {/* Separator */}
      <span className={isVertical ? "my-1 h-px w-full bg-slate-600" : "mx-1 h-6 w-px bg-slate-600"} />

      {tools.map((t) => {
        const active = mode === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => setMode(t.key)}
            data-testid={`tool-${t.key}`}
            className={`px-2.5 py-1.5 rounded flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest transition-colors ${
              active
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/60"
                : "text-slate-300 hover:text-white hover:bg-slate-700/40 border border-transparent"
            } ${isVertical ? "justify-start" : ""}`}
            style={active ? { boxShadow: `0 0 0 1px ${NODE_TYPES[t.key]?.color || "transparent"}` } : {}}
            title={t.label}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className={isVertical ? "" : "hidden sm:inline"}>{t.label}</span>
          </button>
        );
      })}
      {drawingVertexCount > 0 && (
        <>
          <span className={isVertical ? "my-1 h-px w-full bg-slate-600" : "mx-1 h-6 w-px bg-slate-600"} />
          <span className="text-[10px] text-sky-300 font-mono px-1">{drawingVertexCount} vért.</span>
          <button
            onClick={onFinishPolyline}
            disabled={drawingVertexCount < 2}
            data-testid="finish-cable-btn"
            className="px-2 py-1 rounded bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-mono uppercase disabled:opacity-40"
          >
            Terminar
          </button>
          <button
            onClick={onCancelPolyline}
            data-testid="cancel-cable-btn"
            className="px-2 py-1 rounded border border-slate-500 hover:border-red-400 hover:text-red-300 text-[11px]"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
}

/* ============================================================
   Sidebar (dark telecom console, collapsible)
   ============================================================ */
function Sidebar({
  collapsed, onToggle, kmByTipo, totals, nodesCount,
  onExport, onOpenConfig, onDeleteCable, onDeleteNode, cables, nodes,
  spliceLinks, onOpenSpliceDialog, onDeleteSpliceLink,
}) {
  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col items-center text-slate-200 border border-slate-700 rounded-md py-2 w-11"
        style={{ background: "#2c3e50" }}
        data-testid="mapa-sidebar-collapsed"
      >
        <button
          onClick={onToggle}
          className="p-2 rounded hover:bg-slate-700/40"
          title="Expandir Consola FTTH"
          data-testid="sidebar-expand"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="mt-2 space-y-3 text-center">
          <div title="OLTs">
            <Server className="w-4 h-4 text-blue-400 mx-auto" />
            <div className="text-[9px] font-mono">{totals.olts}</div>
          </div>
          <div title="NAPs">
            <Boxes className="w-4 h-4 text-red-400 mx-auto" />
            <div className="text-[9px] font-mono">{totals.naps}</div>
          </div>
          <div title="Clientes">
            <UsersIcon className="w-4 h-4 text-emerald-400 mx-auto" />
            <div className="text-[9px] font-mono">{totals.clients}</div>
          </div>
          <div title="Km fibra">
            <Ruler className="w-4 h-4 text-emerald-300 mx-auto" />
            <div className="text-[9px] font-mono">{km(totals.length_m)}</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="w-full lg:w-[300px] shrink-0 flex flex-col text-slate-200 border border-slate-700 rounded-md overflow-hidden"
      style={{ background: "#2c3e50" }}
      data-testid="mapa-sidebar"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-600 bg-black/20 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-emerald-400 flex items-center gap-1">
            <Signal className="w-3 h-3" /> Consola FTTH · Red
          </div>
          <div className="text-sm font-mono mt-0.5">Plano en tiempo real</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onOpenConfig}
            className="p-1.5 rounded hover:bg-slate-700/60 text-slate-300 hover:text-emerald-300"
            title="Configurar Google Maps API" data-testid="map-cfg-open-btn">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={onToggle}
            className="p-1.5 rounded hover:bg-slate-700/60 text-slate-300 hover:text-emerald-300"
            title="Contraer" data-testid="sidebar-collapse">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-3 border-b border-slate-600 grid grid-cols-3 gap-2">
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-blue-400"><Server className="w-3 h-3 inline mr-0.5" />OLT</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-olts">{totals.olts}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-red-400"><Boxes className="w-3 h-3 inline mr-0.5" />NAP</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-naps">{totals.naps}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-emerald-400"><UsersIcon className="w-3 h-3 inline mr-0.5" />CLI</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-clients">{totals.clients}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-fuchsia-400"><GitCommitVertical className="w-3 h-3 inline mr-0.5" />EMP</div>
          <div className="text-lg font-mono font-bold">{nodesCount.splice}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-sky-400"><Anchor className="w-3 h-3 inline mr-0.5" />POST</div>
          <div className="text-lg font-mono font-bold">{nodesCount.pole}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-amber-400"><Archive className="w-3 h-3 inline mr-0.5" />RES</div>
          <div className="text-lg font-mono font-bold">{nodesCount.reserve}</div>
        </div>
      </div>

      {/* Km totals by cable type */}
      <div className="p-3 border-b border-slate-600 space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Fibra tendida</div>
        {Object.entries(CABLE_STYLES).map(([k, s]) => (
          <div key={k} className="flex items-center gap-2 text-xs font-mono">
            <span className="w-3 h-1 rounded-full" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="text-emerald-300">{km(kmByTipo[k] || 0)} km</span>
          </div>
        ))}
        <div className="pt-1 mt-1 border-t border-slate-700 flex items-center text-xs font-mono">
          <span className="flex-1 font-semibold">TOTAL</span>
          <span className="text-emerald-300 text-sm">{km(totals.length_m)} km</span>
        </div>
      </div>

      {/* Lists (scrollable) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] max-h-[380px] lg:max-h-none">
        {cables.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono mb-1">Cables</div>
            <ul className="space-y-1">
              {cables.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded p-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: c.color || CABLE_STYLES[c.tipo]?.color }} />
                  <span className="flex-1 truncate" title={c.name || CABLE_STYLES[c.tipo]?.label}>
                    {c.name ? c.name : CABLE_STYLES[c.tipo]?.label}
                    <span className="text-slate-400"> · {c.fibers_count || 12}h</span>
                  </span>
                  <span className="text-emerald-300 text-[10px]">{km(c.length_m)}km</span>
                  <button onClick={() => onDeleteCable(c.id)} className="p-0.5 rounded hover:bg-red-500/20"
                    data-testid={`del-cable-${c.id}`}>
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {nodes.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono mb-1">Elementos</div>
            <ul className="space-y-1">
              {nodes.map((n) => {
                const Icon = NODE_TYPES[n.type]?.icon || Package;
                return (
                  <li key={n.id} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded p-1.5">
                    <Icon className="w-3 h-3" style={{ color: NODE_TYPES[n.type]?.color }} />
                    <span className="flex-1 truncate">{n.name}</span>
                    <span className="text-slate-400 text-[10px]">{NODE_TYPES[n.type]?.label}</span>
                    <button onClick={() => onDeleteNode(n.id)} className="p-0.5 rounded hover:bg-red-500/20"
                      data-testid={`del-node-${n.id}`}>
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Virtual splice links · fiber-level connections between ODF ports & cable fibers */}
      <div className="p-3 border-t border-slate-600 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1">
            <Link2 className="w-3 h-3" /> Empalmes virtuales ({(spliceLinks || []).length})
          </div>
          <button
            onClick={onOpenSpliceDialog}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono uppercase"
            data-testid="new-splice-link"
          >
            + Nuevo
          </button>
        </div>
        {(spliceLinks || []).length === 0 ? (
          <div className="text-[10px] text-slate-500 italic">Aún sin empalmes</div>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {spliceLinks.map((s) => (
              <li key={s.id} className="rounded bg-black/20 p-1.5 text-[10px] font-mono">
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-cyan-300" title={`A: ${s.endpoint_a.label}`}>
                      A · #{s.endpoint_a.position} {s.endpoint_a.label || "?"}
                    </div>
                    <div className="truncate text-fuchsia-300" title={`B: ${s.endpoint_b.label}`}>
                      B · #{s.endpoint_b.position} {s.endpoint_b.label || "?"}
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteSpliceLink(s.id)}
                    className="p-0.5 rounded hover:bg-red-500/20"
                    data-testid={`del-splice-${s.id}`}
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Export */}
      <div className="p-3 border-t border-slate-600 bg-black/30">
        <Button
          onClick={onExport}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:opacity-90 text-white font-semibold"
          data-testid="export-json-btn"
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar plano de red a la IA
        </Button>
      </div>
    </aside>
  );
}

/* ============================================================
   JSON export dialog
   ============================================================ */
function JsonExportDialog({ open, onOpenChange, data }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Plano de red · JSON para IA
          </DialogTitle>
        </DialogHeader>
        <pre className="bg-black/60 text-emerald-300 font-mono text-xs p-3 rounded max-h-[420px] overflow-auto whitespace-pre">{text}</pre>
        <DialogFooter>
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(text); toast.success("JSON copiado"); }}>
            <Copy className="w-4 h-4 mr-1" /> Copiar
          </Button>
          <Button onClick={() => {
            const blob = new Blob([text], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `plano-red-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download className="w-4 h-4 mr-1" /> Descargar .json
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Map config dialog (Google Maps API key)
   ============================================================ */
function MapConfigDialog({ open, onOpenChange, current, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (open) { setApiKey(current?.api_key || ""); setTestResult(null); }
  }, [open, current]);

  const runTest = async () => {
    if (!apiKey.trim()) return toast.error("Ingresa una API key");
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post("/map/config/test", { api_key: apiKey.trim() });
      setTestResult(data);
      if (data.ok) toast.success(data.message); else toast.error(data.message);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setTesting(false); }
  };

  const save = async () => {
    if (!apiKey.trim()) return toast.error("La API key no puede estar vacía");
    try {
      await api.patch("/map/config", { api_key: apiKey.trim() });
      toast.success("API key guardada · recargando…");
      onOpenChange(false);
      // Google Maps JS globals can't be re-initialised in-place, so a full
      // page reload is the reliable way to swap keys. Small delay so the
      // toast is visible before the reload kicks in.
      setTimeout(() => window.location.reload(), 500);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> Google Maps API key</DialogTitle>
          <DialogDescription>
            Pega tu key de <a className="underline text-primary"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank" rel="noopener noreferrer">Google Cloud Console</a>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={apiKey} data-testid="map-cfg-key"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy…" className="font-mono" />
          {current?.api_key_masked && !apiKey && (
            <div className="text-[11px] text-muted-foreground font-mono">Actual: {current.api_key_masked}</div>
          )}
          {testResult && (
            <div className={`rounded-md border p-3 text-sm ${
              testResult.ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-red-500/40 bg-red-500/10 text-red-500"
            }`}>
              <div className="flex items-center gap-2 font-semibold">
                {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </div>
              {testResult.hint && <div className="text-xs mt-1 text-muted-foreground">{testResult.hint}</div>}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={runTest} disabled={testing || !apiKey.trim()} data-testid="map-cfg-test">
            {testing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Signal className="w-4 h-4 mr-1" />}
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} data-testid="map-cfg-save">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   PAGE ROOT
   ============================================================ */
/* ============================================================
   Virtual splice-link dialog · connects an ODF port to a specific
   fiber inside a cable (or two ODFs / two cables together).
   Uses the port names configured on the ODF so techs can trace
   the fiber route by human-readable labels.
   ============================================================ */
function endpointOptionsFor(ep, { odfs, cables }) {
  if (!ep.ref_id) return [];
  if (ep.kind === "odf_port") {
    const odf = odfs.find((o) => o.id === ep.ref_id);
    if (!odf) return [];
    const cap = Number(odf.data?.capacity) || 12;
    const ports = odf.data?.ports || [];
    return Array.from({ length: cap }, (_, i) => {
      const p = ports.find((x) => x.position === i + 1);
      return { position: i + 1, label: p?.name || `Puerto ${i + 1}` };
    });
  }
  if (ep.kind === "cable_fiber") {
    const cable = cables.find((c) => c.id === ep.ref_id);
    if (!cable) return [];
    const n = Math.min(Number(cable.fibers_count) || 12, 12);
    return Array.from({ length: n }, (_, i) => {
      const tia = TIA598[i] || { name: `Hilo ${i + 1}`, hex: "#94a3b8" };
      return { position: i + 1, label: tia.name, hex: tia.hex };
    });
  }
  return [];
}

function SpliceLinkDialog({ open, onOpenChange, odfs, cables, onSaved }) {
  const [epA, setEpA] = useState({ kind: "odf_port", ref_id: "", position: 1 });
  const [epB, setEpB] = useState({ kind: "cable_fiber", ref_id: "", position: 1 });
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setEpA({ kind: "odf_port", ref_id: odfs[0]?.id || "", position: 1 });
    setEpB({ kind: "cable_fiber", ref_id: cables[0]?.id || "", position: 1 });
    setNotes("");
  }, [open, odfs, cables]);

  const optsA = endpointOptionsFor(epA, { odfs, cables });
  const optsB = endpointOptionsFor(epB, { odfs, cables });

  const submit = async () => {
    if (!epA.ref_id || !epB.ref_id) return toast.error("Selecciona ambos extremos");
    if (epA.kind === epB.kind && epA.ref_id === epB.ref_id && Number(epA.position) === Number(epB.position)) {
      return toast.error("No puedes empalmar un puerto/hilo consigo mismo");
    }
    const labelA = optsA.find((o) => o.position === Number(epA.position))?.label;
    const labelB = optsB.find((o) => o.position === Number(epB.position))?.label;
    // Prepend the parent element's name for readability in the list.
    const parentA = epA.kind === "odf_port"
      ? odfs.find((o) => o.id === epA.ref_id)?.name
      : cables.find((c) => c.id === epA.ref_id)?.name;
    const parentB = epB.kind === "odf_port"
      ? odfs.find((o) => o.id === epB.ref_id)?.name
      : cables.find((c) => c.id === epB.ref_id)?.name;
    try {
      await api.post("/map/splice-links", {
        endpoint_a: {
          ...epA, position: Number(epA.position),
          label: `${parentA || "?"} · ${labelA || `#${epA.position}`}`,
        },
        endpoint_b: {
          ...epB, position: Number(epB.position),
          label: `${parentB || "?"} · ${labelB || `#${epB.position}`}`,
        },
        notes,
      });
      toast.success("Empalme virtual guardado");
      onOpenChange(false);
      onSaved?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const renderPicker = (title, ep, setEp, opts, prefix) => (
    <div className="rounded-md border border-border p-3 space-y-2 bg-black/10">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Tipo</Label>
          <Select value={ep.kind}
                  onValueChange={(v) => setEp({ kind: v, ref_id: "", position: 1 })}>
            <SelectTrigger data-testid={`${prefix}-kind`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="odf_port">Puerto ODF</SelectItem>
              <SelectItem value="cable_fiber">Hilo de cable</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">{ep.kind === "odf_port" ? "ODF" : "Cable"}</Label>
          <Select value={ep.ref_id}
                  onValueChange={(v) => setEp({ ...ep, ref_id: v, position: 1 })}>
            <SelectTrigger data-testid={`${prefix}-ref`}><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
            <SelectContent>
              {ep.kind === "odf_port"
                ? odfs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name} · {o.data?.capacity || 12}p
                    </SelectItem>
                  ))
                : cables.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || CABLE_STYLES[c.tipo]?.label || "Cable"} · {c.fibers_count || 12}h
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-[10px]">
          {ep.kind === "odf_port" ? "Puerto (nombre configurado en el ODF)" : "Hilo (posición TIA-598)"}
        </Label>
        <Select value={String(ep.position)}
                onValueChange={(v) => setEp({ ...ep, position: Number(v) })}>
          <SelectTrigger data-testid={`${prefix}-pos`}><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-60">
            {opts.map((o) => (
              <SelectItem key={o.position} value={String(o.position)}>
                <span className="inline-flex items-center gap-2">
                  {o.hex && (
                    <span className="w-2.5 h-2.5 rounded-full border border-white/40 shrink-0"
                          style={{ background: o.hex }} />
                  )}
                  <span className="font-mono">#{o.position}</span>
                  <span>· {o.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const disabled = (odfs.length === 0 && cables.length < 2) || (odfs.length + cables.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" /> Nuevo empalme virtual
          </DialogTitle>
          <DialogDescription>
            Conecta un puerto de ODF con un hilo específico de un cable (o dos puertos, o dos hilos).
            Los nombres de los puertos se toman de la configuración del ODF; los hilos usan el código TIA-598.
          </DialogDescription>
        </DialogHeader>

        {disabled ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-300">
            Necesitas al menos un ODF <b>y</b> un cable (o dos cables / dos ODFs) para poder empalmar.
          </div>
        ) : (
          <div className="space-y-3">
            {renderPicker("Origen (A)", epA, setEpA, optsA, "splice-a")}
            <div className="text-center text-primary text-xs font-mono">↕ empalma con ↕</div>
            {renderPicker("Destino (B)", epB, setEpB, optsB, "splice-b")}

            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm"
                placeholder="Ej: hilo #3 verde va a la sucursal norte"
                data-testid="splice-notes"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={disabled} data-testid="splice-save">
            <Link2 className="w-4 h-4 mr-1" /> Guardar empalme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MapaRed() {
  const containerRef = useRef(null);
  const mapContainerRef = useRef(null); // outer wrapper — target for fullscreen
  const mapRef = useRef(null);
  const modeRef = useRef("pan");
  const drawingRef = useRef({ polyline: null, path: [] });
  const napMarkersRef = useRef(new Map());
  const nodeMarkersRef = useRef(new Map());
  const clientMarkersRef = useRef(new Map());
  const cablePolylinesRef = useRef(new Map());
  const kmMarkersRef = useRef(new Map()); // cableId → [markers]

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [naps, setNaps] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [clients, setClients] = useState([]);
  const [cables, setCables] = useState([]);
  const [mapConfig, setMapConfig] = useState(null);
  const [mode, setModeState] = useState("pan");
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingCableId, setEditingCableId] = useState(null);
  const [editCableProps, setEditCableProps] = useState(null); // cable being metadata-edited
  // Explicit "add vertex" mode: when set to the id of a cable, the next
  // click on that cable's polyline inserts a new vertex at the click point
  // (instead of the default behaviour of opening the InfoWindow).
  const [addVertexFor, setAddVertexFor] = useState(null);
  const editingCableIdRef = useRef(null);
  const addVertexForRef = useRef(null);
  useEffect(() => { editingCableIdRef.current = editingCableId; }, [editingCableId]);
  useEffect(() => { addVertexForRef.current = addVertexFor; }, [addVertexFor]);
  const [spliceLinks, setSpliceLinks] = useState([]);
  const [spliceDialogOpen, setSpliceDialogOpen] = useState(false);

  const setMode = useCallback((m) => { modeRef.current = m; setModeState(m); }, []);

  const [pendingCoords, setPendingCoords] = useState(null); // for new node dialog
  const [pendingNodeType, setPendingNodeType] = useState(null);
  const [pendingCable, setPendingCable] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [exportPayload, setExportPayload] = useState({ nodos: [], cables: [] });

  const olts = useMemo(() => nodes.filter((n) => n.type === "olt_map"), [nodes]);
  const odfs = useMemo(() => nodes.filter((n) => n.type === "odf"), [nodes]);
  const nodesCount = useMemo(() => ({
    splice: nodes.filter((n) => n.type === "splice").length,
    pole: nodes.filter((n) => n.type === "pole").length,
    reserve: nodes.filter((n) => n.type === "reserve").length,
    olt: olts.length,
  }), [nodes, olts]);

  const kmByTipo = useMemo(() => {
    const t = { troncal: 0, distribucion: 0, drop: 0 };
    for (const c of cables) t[c.tipo] = (t[c.tipo] || 0) + Number(c.length_m || 0);
    return t;
  }, [cables]);

  const totals = useMemo(() => ({
    length_m: cables.reduce((a, c) => a + Number(c.length_m || 0), 0),
    naps: naps.length,
    clients: clients.length,
    olts: olts.length,
  }), [cables, naps, clients, olts]);

  const reload = useCallback(async () => {
    try {
      const [napsRes, nodesRes, clientsRes, cablesRes, cfgRes, linksRes] = await Promise.all([
        api.get("/nap-boxes"),
        api.get("/map/nodes").catch(() => ({ data: [] })),
        api.get("/clients").then((r) => ({ data: (r.data || []).filter((c) => c.lat != null && c.lng != null) })),
        api.get("/map/cables"),
        api.get("/map/config").catch(() => ({ data: null })),
        api.get("/map/splice-links").catch(() => ({ data: [] })),
      ]);
      setNaps(napsRes.data);
      setNodes(nodesRes.data);
      setClients(clientsRes.data);
      setCables(cablesRes.data);
      setSpliceLinks(linksRes.data);
      if (cfgRes.data) setMapConfig(cfgRes.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Init Google Maps — runs ONCE per mount. We deliberately do NOT depend on
  // `mapConfig?.api_key` because that would cause a double init: first pass
  // with the env key (before /map/config resolves), then a second pass with
  // the same key from the DB, resulting in "Google Maps loaded multiple
  // times" and click listeners attached to a stale (invisible) map instance.
  // If the user swaps the key via the config dialog we do a full page reload
  // instead (see MapConfigDialog.save), so no in-place re-init is needed.
  useEffect(() => {
    if (mapRef.current) return;                       // already initialised
    let cancelled = false;
    const activeKey = GOOGLE_MAPS_KEY_ENV || mapConfig?.api_key;
    if (!activeKey) return;

    loadGoogleMaps(activeKey).then((google) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: true,
        streetViewControl: false,
        // Use our own fullscreen button (in the toolbar) so the drawing
        // tools go fullscreen together with the map. Google's built-in
        // control only fullscreens the inner map div and hides the tools.
        fullscreenControl: false,
        disableDoubleClickZoom: true,
        mapTypeId: "hybrid",
      });
      mapRef.current = map;
      window.gm_authFailure = () => setMapError(
        "Google Maps rechazó la key. Habilita Maps JavaScript API + billing + añade este dominio a referrers."
      );
      setReady(true);
    }).catch((e) => setMapError(e.message));

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click / dblclick listeners depending on mode
  useEffect(() => {
    if (!ready) return;
    const google = window.google;
    const map = mapRef.current;
    if (!map || !google) return;

    const clickListener = map.addListener("click", (e) => {
      const m = modeRef.current;
      const coords = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (m === "cable") {
        if (!drawingRef.current.polyline) {
          const poly = new google.maps.Polyline({
            path: [e.latLng], strokeColor: "#38bdf8", strokeWeight: 4, editable: false, map,
          });
          drawingRef.current = { polyline: poly, path: [coords] };
        } else {
          drawingRef.current.polyline.getPath().push(e.latLng);
          drawingRef.current.path.push(coords);
        }
        setDrawingVertexCount(drawingRef.current.path.length);
      } else if (m !== "pan") {
        // Any non-pan mode opens the node dialog with that type preselected
        setPendingCoords(coords);
        setPendingNodeType(m);
        setMode("pan");
      }
    });

    const dblListener = map.addListener("dblclick", () => {
      if (drawingRef.current.polyline && drawingRef.current.path.length >= 2) finishPolyline();
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(dblListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const finishPolyline = useCallback(() => {
    const google = window.google;
    const draft = drawingRef.current;
    if (!google || !draft.polyline || draft.path.length < 2) return;
    const lengthM = google.maps.geometry.spherical.computeLength(draft.polyline.getPath());
    setPendingCable({ overlay: draft.polyline, path: draft.path.slice(), length: lengthM });
    drawingRef.current = { polyline: null, path: [] };
    setDrawingVertexCount(0);
    setMode("pan");
  }, [setMode]);

  const cancelPolyline = useCallback(() => {
    if (drawingRef.current.polyline) drawingRef.current.polyline.setMap(null);
    drawingRef.current = { polyline: null, path: [] };
    setDrawingVertexCount(0);
  }, []);

  // Update cursor per mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({ draggableCursor: mode === "pan" ? null : "crosshair" });
  }, [mode]);

  // Fullscreen: when the outer container enters/exits fullscreen, resize
  // the inner map div and trigger Google Maps' resize event so tiles refit.
  useEffect(() => {
    const handler = () => {
      const inner = containerRef.current;
      const outer = mapContainerRef.current;
      if (!inner || !outer) return;
      const fs = document.fullscreenElement === outer;
      if (fs) {
        inner.style.height = "100vh";
        outer.style.minHeight = "100vh";
      } else {
        inner.style.height = "680px";
        outer.style.minHeight = "680px";
      }
      if (mapRef.current && window.google) {
        window.google.maps.event.trigger(mapRef.current, "resize");
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Sync NAP markers
  useEffect(() => {
    if (!ready || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    const seen = new Set();
    for (const nap of naps) {
      seen.add(nap.id);
      let entry = napMarkersRef.current.get(nap.id);
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: nap.lat, lng: nap.lng }, map, draggable: true,
          icon: makeMarkerIcon(google, {
            type: "nap",
            name: nap.name || "NAP",
            color: nap.color || "#ef4444",
            size: 44,
          }),
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700;font-size:13px">${nap.name}</div>
            <div>Tipo: <b>NAP ${nap.port_type || "1x16"}</b></div>
            <div>Puertos: <b>${nap.used_ports || 0}/${nap.capacity}</b></div>
          </div>`,
        });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        marker.addListener("dragend", async () => {
          const p = marker.getPosition();
          try { await api.patch(`/nap-boxes/${nap.id}`, { lat: p.lat(), lng: p.lng() }); toast.success(`NAP "${nap.name}" reubicada`); reload(); }
          catch (e) { toast.error(formatApiError(e)); }
        });
        entry = { marker };
        napMarkersRef.current.set(nap.id, entry);
      }
    }
    for (const [id, entry] of napMarkersRef.current.entries()) {
      if (!seen.has(id)) { entry.marker.setMap(null); napMarkersRef.current.delete(id); }
    }
  }, [naps, ready, reload]);

  // Sync generic nodes (splice, pole, reserve, olt_map)
  useEffect(() => {
    if (!ready || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    const seen = new Set();
    for (const n of nodes) {
      seen.add(n.id);
      let entry = nodeMarkersRef.current.get(n.id);
      const style = NODE_TYPES[n.type] || { color: "#94a3b8" };
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: n.lat, lng: n.lng }, map, draggable: true,
          icon: makeMarkerIcon(google, {
            type: n.type,
            name: n.name || style.label,
            color: n.color || style.color,
            size: n.type === "olt_map" ? 48 : 40,
          }),
        });
        const d = n.data || {};
        const detail = n.type === "olt_map"
          ? `Tec: <b>${(d.technology || "").toUpperCase()}</b> · Marca: <b>${d.brand || "?"}</b> · Puertos: <b>${d.ports || "?"}</b>`
          : n.type === "odf"
          ? `Capacidad: <b>${d.capacity || 0}</b> fibras · Puertos: <b>${(d.ports || []).length}</b>`
          : n.type === "reserve"
          ? `Reserva: <b>${d.reserve_m || 0} m</b>`
          : n.type === "splice"
          ? `Hilos empalmados: <b>${d.fibers_count || 12}</b>`
          : n.type === "pole"
          ? `${d.material || "?"} · ${d.height_m || "?"} m`
          : "";
        // ODF gets a scrollable list of port names inside the InfoWindow so
        // techs can see every fiber the frame is carrying at a glance.
        const odfPortList = n.type === "odf" && (d.ports || []).length
          ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #ccc;font-size:11px;max-height:160px;overflow-y:auto">
              <div style="font-weight:700;margin-bottom:2px">Puertos:</div>
              ${d.ports.map((p) => `#${p.position} · ${(p.name || "").replace(/</g, "&lt;")}`).join("<br/>")}
            </div>`
          : "";
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111;min-width:180px">
            <div style="font-weight:700;font-size:13px">${n.name}</div>
            <div>Tipo: <b>${style.label || n.type}</b></div>
            ${detail ? `<div>${detail}</div>` : ""}
            ${n.notes ? `<div style="color:#555">${n.notes}</div>` : ""}
            ${odfPortList}
          </div>`,
        });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        marker.addListener("dragend", async () => {
          const p = marker.getPosition();
          try { await api.patch(`/map/nodes/${n.id}`, { lat: p.lat(), lng: p.lng() }); reload(); }
          catch (e) { toast.error(formatApiError(e)); }
        });
        entry = { marker };
        nodeMarkersRef.current.set(n.id, entry);
      }
    }
    for (const [id, entry] of nodeMarkersRef.current.entries()) {
      if (!seen.has(id)) { entry.marker.setMap(null); nodeMarkersRef.current.delete(id); }
    }
  }, [nodes, ready, reload]);

  // Sync client markers
  useEffect(() => {
    if (!ready || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    const seen = new Set();
    for (const c of clients) {
      seen.add(c.id);
      let entry = clientMarkersRef.current.get(c.id);
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: c.lat, lng: c.lng }, map, draggable: true,
          icon: makeMarkerIcon(google, {
            type: "client",
            name: c.full_name || "Cliente",
            color: "#22c55e",
            size: 36,
          }),
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700">${c.full_name}</div>
            <div>${c.phone || ""}</div>
            <div>${c.address || ""}</div>
          </div>`,
        });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        marker.addListener("dragend", async () => {
          const p = marker.getPosition();
          try { await api.patch(`/clients/${c.id}`, { lat: p.lat(), lng: p.lng() }); reload(); }
          catch (e) { toast.error(formatApiError(e)); }
        });
        entry = { marker };
        clientMarkersRef.current.set(c.id, entry);
      }
    }
    for (const [id, entry] of clientMarkersRef.current.entries()) {
      if (!seen.has(id)) { entry.marker.setMap(null); clientMarkersRef.current.delete(id); }
    }
  }, [clients, ready, reload]);

  // Sync cable polylines + km markers
  useEffect(() => {
    if (!ready || !window.google) return;
    const google = window.google;
    const map = mapRef.current;
    const seen = new Set();

    for (const cable of cables) {
      seen.add(cable.id);
      const style = CABLE_STYLES[cable.tipo] || CABLE_STYLES.distribucion;
      // Prefer per-cable custom color/weight (set by the user), fall back to
      // the tipo preset defaults so legacy cables still render.
      const strokeColor = cable.color || style.color;
      const strokeWeight = Number(cable.weight) || style.weight;
      let entry = cablePolylinesRef.current.get(cable.id);

      if (!entry) {
        const polyline = new google.maps.Polyline({
          path: cable.path.map((p) => ({ lat: p.lat, lng: p.lng })),
          strokeColor, strokeWeight,
          // Cables are STATIC by default. Clicking one enters edit mode
          // (see click listener below + editingCableId useEffect further down)
          // which flips this to true so the user can drag, add or delete
          // vertices. Right-click on a vertex removes it (Google default).
          editable: false,
          clickable: true,
          map,
        });
        const displayName = cable.name || style.label;
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700">${displayName}</div>
            <div>Tipo: <b>${style.label}</b></div>
            <div>Longitud: <b>${Number(cable.length_m || 0).toFixed(2)} m</b> · ${km(cable.length_m)} km</div>
            <div>Hilos: <b>${cable.fibers_count || 12}</b> (TIA-598)</div>
          </div>`,
        });
        polyline.addListener("click", (e) => {
          // "Add vertex" mode: if the user has explicitly clicked the
          // "Agregar punto" button, insert a new vertex at the click
          // position on the exact edge and exit the mode. Google's `e.edge`
          // provides the 0-based index of the edge that was clicked when
          // the polyline is editable — we insert at edge+1 so it lands
          // between the two neighboring vertices.
          if (addVertexForRef.current === cable.id && e.latLng) {
            const path = polyline.getPath();
            const insertAt = typeof e.edge === "number" ? e.edge + 1 : path.getLength();
            path.insertAt(insertAt, e.latLng);
            setAddVertexFor(null);
            toast.success("Punto agregado");
            return;
          }
          info.setPosition(e.latLng);
          info.open({ map });
          // Enter edit mode for THIS cable. The useEffect below will flip
          // `editable` to true on its polyline and false on every other one.
          setEditingCableId(cable.id);
        });
        // Right-click on a vertex → remove it (only fires while polyline
        // is editable and the click landed on an existing vertex).
        polyline.addListener("rightclick", (e) => {
          if (e.vertex == null) return;
          const p = polyline.getPath();
          if (p.getLength() <= 2) {
            toast.warning("El cable debe tener al menos 2 vértices");
            return;
          }
          p.removeAt(e.vertex);
          // The remove_at listener attached below auto-persists the new
          // path via PATCH /api/map/cables/{id}.
        });
        const path = polyline.getPath();
        const onEdit = async () => {
          const newPath = [];
          path.forEach((p) => newPath.push({ lat: p.lat(), lng: p.lng() }));
          const newLen = google.maps.geometry.spherical.computeLength(path);
          try { await api.patch(`/map/cables/${cable.id}`, { path: newPath, length_m: newLen }); } catch {}
          setCables((prev) => prev.map((c) =>
            c.id === cable.id ? { ...c, path: newPath, length_m: newLen } : c
          ));
        };
        google.maps.event.addListener(path, "set_at", onEdit);
        google.maps.event.addListener(path, "insert_at", onEdit);
        google.maps.event.addListener(path, "remove_at", onEdit);
        entry = { polyline };
        cablePolylinesRef.current.set(cable.id, entry);
      } else {
        entry.polyline.setOptions({ strokeColor, strokeWeight });
      }

      // Rebuild 1km markers along this cable
      const existing = kmMarkersRef.current.get(cable.id) || [];
      for (const m of existing) m.setMap(null);
      const kmMarkers = [];
      const totalM = Number(cable.length_m || 0);
      if (totalM >= 1000) {
        const p = entry.polyline.getPath();
        // Precompute cumulative distances per segment for interpolation
        const cum = [0];
        for (let i = 1; i < p.getLength(); i++) {
          cum.push(cum[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(p.getAt(i - 1), p.getAt(i)));
        }
        const totalKm = Math.floor(totalM / 1000);
        for (let k = 1; k <= totalKm; k++) {
          const target = k * 1000;
          // Find segment containing target distance
          let idx = 1;
          while (idx < cum.length && cum[idx] < target) idx++;
          if (idx >= cum.length) break;
          const segLen = cum[idx] - cum[idx - 1];
          const frac = segLen > 0 ? (target - cum[idx - 1]) / segLen : 0;
          const pos = google.maps.geometry.spherical.interpolate(p.getAt(idx - 1), p.getAt(idx), frac);
          const marker = new google.maps.Marker({
            position: pos, map, clickable: false,
            label: { text: `${k}K`, color: "#fff", fontSize: "9px", fontWeight: "bold" },
            icon: {
              path: google.maps.SymbolPath.CIRCLE, scale: 8,
              fillColor: strokeColor, fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 1,
            },
            zIndex: 999,
          });
          kmMarkers.push(marker);
        }
      }
      kmMarkersRef.current.set(cable.id, kmMarkers);
    }

    // Cleanup
    for (const [id, entry] of cablePolylinesRef.current.entries()) {
      if (!seen.has(id)) {
        entry.polyline.setMap(null);
        cablePolylinesRef.current.delete(id);
        const kms = kmMarkersRef.current.get(id) || [];
        for (const m of kms) m.setMap(null);
        kmMarkersRef.current.delete(id);
      }
    }
  }, [cables, ready]);

  // Toggle `editable` per polyline based on which cable is being edited.
  // Runs whenever the user clicks a cable (setEditingCableId) OR when the
  // cable list changes (so newly-added polylines pick up the current state).
  useEffect(() => {
    for (const [id, entry] of cablePolylinesRef.current.entries()) {
      entry.polyline.setOptions({ editable: id === editingCableId });
    }
    // Leaving edit mode also cancels any pending "add vertex" gesture.
    if (!editingCableId) setAddVertexFor(null);
  }, [editingCableId, cables]);

  // Confirm cable
  const confirmCable = async ({ tipo, fibers, name, color, weight }) => {
    if (!pendingCable) return;
    const style = CABLE_STYLES[tipo];
    try {
      await api.post("/map/cables", {
        tipo,
        name: name || "",
        path: pendingCable.path,
        length_m: pendingCable.length,
        fibers_count: Number(fibers),
        color: color || style.color,
        weight: Number(weight) || style.weight,
      });
      pendingCable.overlay.setMap(null);
      setPendingCable(null);
      const label = name || style.label;
      toast.success(`Cable "${label}" · ${fibers} ${fibers === 1 ? "hilo" : "hilos"} · ${pendingCable.length.toFixed(2)}m guardado`);
      reload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  // Save metadata edits (name / tipo / fibers / color / weight) on an
  // existing cable. The path itself is auto-saved on every vertex drag
  // via the set_at/insert_at/remove_at listeners in the sync effect.
  const saveEditedCable = async ({ tipo, fibers, name, color, weight }) => {
    if (!editCableProps) return;
    const style = CABLE_STYLES[tipo] || CABLE_STYLES.distribucion;
    try {
      await api.patch(`/map/cables/${editCableProps.id}`, {
        tipo,
        name: name || "",
        fibers_count: Number(fibers),
        color: color || style.color,
        weight: Number(weight) || style.weight,
      });
      toast.success(`Cable "${name || style.label}" actualizado`);
      setEditCableProps(null);
      reload();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const discardCable = () => {
    if (pendingCable) pendingCable.overlay.setMap(null);
    setPendingCable(null);
  };

  const deleteCable = async (id) => {
    if (!window.confirm("¿Eliminar este cable?")) return;
    try { await api.delete(`/map/cables/${id}`); toast.success("Cable eliminado"); reload(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const deleteNode = async (id) => {
    if (!window.confirm("¿Eliminar este elemento?")) return;
    try { await api.delete(`/map/nodes/${id}`); toast.success("Eliminado"); reload(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const deleteSpliceLink = async (id) => {
    if (!window.confirm("¿Eliminar este empalme virtual?")) return;
    try { await api.delete(`/map/splice-links/${id}`); toast.success("Empalme eliminado"); reload(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const exportJson = () => {
    const nodos = [
      ...olts.map((o, i) => ({
        id: `olt-${o.id}`, idx: i + 1, tipo: "OLT",
        lat: o.lat, lng: o.lng, info: o.data || {},
      })),
      ...naps.map((n, i) => ({
        id: `nap-${n.id}`, idx: olts.length + i + 1, tipo: "NAP",
        lat: n.lat, lng: n.lng,
        info: { nombre: n.name, capacidad: n.port_type, puertos_ocupados: n.used_ports || 0, capacidad_total: n.capacity },
      })),
      ...nodes.filter((n) => n.type !== "olt_map").map((n) => ({
        id: `${n.type}-${n.id}`, tipo: NODE_TYPES[n.type]?.label || n.type,
        lat: n.lat, lng: n.lng, info: { nombre: n.name, ...(n.data || {}) },
      })),
      ...clients.map((c) => ({
        id: `client-${c.id}`, tipo: "Cliente",
        lat: c.lat, lng: c.lng, info: { nombre: c.full_name, telefono: c.phone },
      })),
    ];
    const cablesOut = cables.map((c, i) => ({
      id: `cable-${c.id}`, idx: i + 1,
      tipo: CABLE_STYLES[c.tipo]?.label || c.tipo,
      hilos: c.fibers_count || 12,
      longitud_metros: Number(c.length_m || 0).toFixed(2),
      ruta_coordenadas: c.path,
    }));
    setExportPayload({
      generado_en: new Date().toISOString(),
      resumen: {
        olts: olts.length, naps: naps.length, clientes: clients.length,
        cables: cables.length,
        fibra_troncal_km: km(kmByTipo.troncal),
        fibra_distribucion_km: km(kmByTipo.distribucion),
        fibra_drop_km: km(kmByTipo.drop),
        fibra_total_km: km(totals.length_m),
      },
      nodos, cables: cablesOut,
    });
    setExportOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Mapa de servicio"
        subtitle="Traza tu red FTTH sobre Google Maps. Cada cable calcula su longitud y muestra el código de color TIA-598. Marcadores automáticos cada 1 km."
      />

      {!GOOGLE_MAPS_KEY_ENV && !mapConfig?.has_key && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm mb-3 flex items-start gap-3">
          <KeyRound className="w-4 h-4 text-amber-500 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-amber-500">API key de Google Maps no configurada</div>
          </div>
          <Button size="sm" onClick={() => setConfigOpen(true)}>
            <Settings2 className="w-3.5 h-3.5 mr-1" /> Configurar
          </Button>
        </div>
      )}
      {mapError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm mb-3 text-red-500">{mapError}</div>
      )}

      <div className="flex flex-col lg:flex-row gap-3">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          kmByTipo={kmByTipo}
          totals={totals}
          nodesCount={nodesCount}
          onExport={exportJson}
          onOpenConfig={() => setConfigOpen(true)}
          onDeleteCable={deleteCable}
          onDeleteNode={deleteNode}
          cables={cables}
          nodes={nodes}
          spliceLinks={spliceLinks}
          onOpenSpliceDialog={() => setSpliceDialogOpen(true)}
          onDeleteSpliceLink={deleteSpliceLink}
        />

        <div ref={mapContainerRef}
             className="flex-1 rounded-md border border-border overflow-hidden bg-card relative"
             style={{ minHeight: 680 }} data-testid="mapa-container">
          <MapToolbar
            mode={mode}
            setMode={setMode}
            drawingVertexCount={drawingVertexCount}
            onFinishPolyline={finishPolyline}
            onCancelPolyline={cancelPolyline}
            containerEl={mapContainerRef.current}
          />

          {/* Floating pill shown while a cable is in edit mode. The path is
              auto-persisted on every vertex change (drag / insert / remove)
              via the set_at / insert_at / remove_at listeners on the path.
              A visible legend below the pill teaches the user how to add
              and remove vertices — both natively (drag midpoint, right-click)
              and via the explicit "Agregar punto" click mode. */}
          {editingCableId && (() => {
            const cable = cables.find((c) => c.id === editingCableId);
            const label = cable?.name || CABLE_STYLES[cable?.tipo]?.label || "Cable";
            const addingHere = addVertexFor === editingCableId;
            return (
              <div className="absolute z-40 top-3 right-3 flex flex-col items-end gap-1.5"
                   data-testid="cable-edit-pill">
                {/* Actions row */}
                <div className="flex items-center gap-2 rounded-full bg-emerald-500/95 backdrop-blur px-3 py-1.5 border border-emerald-300 shadow-2xl">
                  <span className="text-white text-[11px] font-mono uppercase tracking-widest">
                    Editando · {label}
                  </span>
                  <button
                    onClick={() => setAddVertexFor(addingHere ? null : editingCableId)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 transition-colors ${
                      addingHere
                        ? "bg-sky-500 text-white ring-2 ring-sky-200"
                        : "bg-white/20 hover:bg-white/40 text-white"
                    }`}
                    data-testid="add-vertex-mode"
                  >
                    <Plus className="w-3.5 h-3.5" /> {addingHere ? "Click en el cable…" : "Agregar punto"}
                  </button>
                  <button
                    onClick={() => setEditCableProps(cable)}
                    className="rounded-full bg-white/20 hover:bg-white/40 text-white px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 transition-colors"
                    data-testid="edit-cable-props"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Propiedades
                  </button>
                  <button
                    onClick={() => setEditingCableId(null)}
                    className="rounded-full bg-white/20 hover:bg-white/40 text-white px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 transition-colors"
                    data-testid="finalize-cable-edit"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Finalizar
                  </button>
                </div>

                {/* Legend row · always visible so the user knows all 3 actions */}
                <div className="flex flex-col gap-0.5 rounded-md bg-slate-900/90 backdrop-blur px-3 py-1.5 border border-slate-600 text-[10px] text-slate-200 font-mono max-w-[420px]">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white border border-slate-800 shrink-0" />
                    <span><b className="text-emerald-300">Cuadrado</b> = punto existente · arrastra para <b>moverlo</b></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plus className="w-3 h-3 text-sky-300 shrink-0" />
                    <span><b className="text-sky-300">Agregar punto</b> · click el botón y luego click en el cable donde lo quieras</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-3 h-3 text-red-300 shrink-0" />
                    <span><b className="text-red-300">Click-derecho</b> sobre un punto para <b>eliminarlo</b> (mínimo 2)</span>
                  </div>
                </div>
              </div>
            );
          })()}

          <div ref={containerRef} style={{ width: "100%", height: 680 }} />
        </div>
      </div>

      {/* Legend bottom */}
      <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {Object.entries(CABLE_STYLES).map(([k, s]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block rounded" style={{ background: s.color, width: 20, height: Math.min(s.weight, 4) }} /> {s.label}
          </span>
        ))}
        <Badge variant="outline" className="ml-auto text-[10px] font-mono">
          TIA-598 · 1km markers · geometry
        </Badge>
      </div>

      {/* Dialogs */}
      <NewElementDialog
        open={!!pendingCoords}
        onOpenChange={(v) => { if (!v) { setPendingCoords(null); setPendingNodeType(null); } }}
        coords={pendingCoords}
        initialType={pendingNodeType}
        onSaved={reload}
      />
      <CableTypeDialog
        open={!!pendingCable}
        onOpenChange={(v) => { if (!v) discardCable(); }}
        lengthM={pendingCable?.length || 0}
        onConfirm={confirmCable}
      />
      <CableTypeDialog
        open={!!editCableProps}
        onOpenChange={(v) => { if (!v) setEditCableProps(null); }}
        lengthM={Number(editCableProps?.length_m) || 0}
        initial={editCableProps}
        onConfirm={saveEditedCable}
      />
      <JsonExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        data={exportPayload}
      />
      <MapConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        current={mapConfig}
      />
      <SpliceLinkDialog
        open={spliceDialogOpen}
        onOpenChange={setSpliceDialogOpen}
        odfs={odfs}
        cables={cables}
        onSaved={reload}
      />
    </div>
  );
}
