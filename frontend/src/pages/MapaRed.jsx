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
  client:    { label: "Cliente",      icon: UsersIcon,         color: "#22c55e" },
  cable:     { label: "Cable",        icon: Cable,             color: "#0ea5e9" },
  pan:       { label: "Mover",        icon: MousePointer2,     color: "#94a3b8" },
};

const OLT_BRANDS = ["V-Sol", "Huawei", "ZTE", "Fiberhome", "C-Data", "BDCOM", "Nokia", "Otro"];
const OLT_TECH = ["gpon", "epon"];

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
            {["nap", "splice", "pole", "reserve", "olt_map", "client"].map((k) => {
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
   ============================================================ */
function CableTypeDialog({ open, onOpenChange, lengthM, onConfirm }) {
  const [tipo, setTipo] = useState("distribucion");
  const [fibers, setFibers] = useState(12);
  useEffect(() => { if (open) { setTipo("distribucion"); setFibers(12); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="w-4 h-4 text-primary" /> Nuevo cable
          </DialogTitle>
          <DialogDescription>
            Longitud calculada: <span className="font-mono text-primary">{lengthM.toFixed(2)} m</span> ({km(lengthM)} km)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">Tipo de tendido</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(CABLE_STYLES).map(([k, s]) => (
                <button
                  key={k}
                  onClick={() => setTipo(k)}
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

          <div>
            <Label className="text-xs mb-1 block">Cantidad de hilos (TIA-598)</Label>
            <div className="grid grid-cols-4 gap-2">
              {[6, 8, 12, 24].map((n) => (
                <button
                  key={n}
                  onClick={() => setFibers(n)}
                  data-testid={`cable-fibers-${n}`}
                  className={`rounded-md border p-2 font-mono transition-colors ${
                    fibers === n ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  {n} hilos
                </button>
              ))}
            </div>
            <div className="mt-2 rounded-md border border-border p-2 bg-muted/30">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
                Código de color · TIA-598 ({fibers} hilos)
              </div>
              <Tia598Legend count={fibers} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Descartar</Button>
          <Button onClick={() => onConfirm(tipo, fibers)} data-testid="cable-save">
            Guardar cable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   Floating TOP TOOLBAR inside the map
   ============================================================ */
function MapToolbar({ mode, setMode, drawingVertexCount, onFinishPolyline, onCancelPolyline }) {
  const tools = [
    { key: "pan",     icon: MousePointer2,     label: "Mover" },
    { key: "nap",     icon: Boxes,             label: "NAP" },
    { key: "splice",  icon: GitCommitVertical, label: "Empalme" },
    { key: "pole",    icon: Anchor,            label: "Poste" },
    { key: "reserve", icon: Archive,           label: "Reserva" },
    { key: "olt_map", icon: Server,            label: "OLT" },
    { key: "client",  icon: UsersIcon,         label: "Cliente" },
    { key: "cable",   icon: Cable,             label: "Cable" },
  ];
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-lg bg-slate-900/85 backdrop-blur px-2 py-1.5 border border-slate-700 shadow-xl">
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
            }`}
            style={active ? { boxShadow: `0 0 0 1px ${NODE_TYPES[t.key]?.color || "transparent"}` } : {}}
            title={t.label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        );
      })}
      {drawingVertexCount > 0 && (
        <>
          <span className="mx-1 h-6 w-px bg-slate-600" />
          <span className="text-[10px] text-sky-300 font-mono">{drawingVertexCount} vért.</span>
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
                  <span className="w-2 h-2 rounded-full" style={{ background: CABLE_STYLES[c.tipo]?.color }} />
                  <span className="flex-1 truncate">
                    {CABLE_STYLES[c.tipo]?.label} · {c.fibers_count || 12}h
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
      toast.success("API key guardada · recargando mapa…");
      onSaved?.(apiKey.trim());
      onOpenChange(false);
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
export default function MapaRed() {
  const containerRef = useRef(null);
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

  const setMode = useCallback((m) => { modeRef.current = m; setModeState(m); }, []);

  const [pendingCoords, setPendingCoords] = useState(null); // for new node dialog
  const [pendingNodeType, setPendingNodeType] = useState(null);
  const [pendingCable, setPendingCable] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [scriptReloadNonce, setScriptReloadNonce] = useState(0);
  const [exportPayload, setExportPayload] = useState({ nodos: [], cables: [] });

  const olts = useMemo(() => nodes.filter((n) => n.type === "olt_map"), [nodes]);
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
      const [napsRes, nodesRes, clientsRes, cablesRes, cfgRes] = await Promise.all([
        api.get("/nap-boxes"),
        api.get("/map/nodes").catch(() => ({ data: [] })),
        api.get("/clients").then((r) => ({ data: (r.data || []).filter((c) => c.lat != null && c.lng != null) })),
        api.get("/map/cables"),
        api.get("/map/config").catch(() => ({ data: null })),
      ]);
      setNaps(napsRes.data);
      setNodes(nodesRes.data);
      setClients(clientsRes.data);
      setCables(cablesRes.data);
      if (cfgRes.data) setMapConfig(cfgRes.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Init Google Maps
  useEffect(() => {
    let cancelled = false;
    const activeKey = mapConfig?.api_key || GOOGLE_MAPS_KEY_ENV;
    if (!activeKey) return;

    loadGoogleMaps(activeKey).then((google) => {
      if (cancelled || !containerRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        center: { lat: 19.4326, lng: -99.1332 },
        zoom: 13,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
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
  }, [mapConfig?.api_key, scriptReloadNonce]);

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
          label: { text: nap.name || "NAP", className: "gm-label-nap", color: "#fff", fontSize: "10px", fontWeight: "bold" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 10,
            fillColor: nap.color || "#ef4444", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2,
          },
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
        const shape = n.type === "olt_map"
          ? { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6 }
          : n.type === "pole"
          ? { path: "M -6,-8 L 6,-8 L 6,8 L -6,8 z", scale: 0.8 }
          : n.type === "splice"
          ? { path: "M 0,-8 L 6,0 L 0,8 L -6,0 z", scale: 1.2 }
          : n.type === "reserve"
          ? { path: "M -6,-4 L 6,-4 L 6,4 L -6,4 z", scale: 1.2 }
          : { path: google.maps.SymbolPath.CIRCLE, scale: 8 };
        const marker = new google.maps.Marker({
          position: { lat: n.lat, lng: n.lng }, map, draggable: true,
          label: { text: n.name || style.label, color: "#fff", fontSize: "10px", fontWeight: "bold" },
          icon: { ...shape, fillColor: n.color || style.color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        });
        const d = n.data || {};
        const detail = n.type === "olt_map"
          ? `Tec: <b>${(d.technology || "").toUpperCase()}</b> · Marca: <b>${d.brand || "?"}</b> · Puertos: <b>${d.ports || "?"}</b>`
          : n.type === "reserve"
          ? `Reserva: <b>${d.reserve_m || 0} m</b>`
          : n.type === "splice"
          ? `Hilos empalmados: <b>${d.fibers_count || 12}</b>`
          : n.type === "pole"
          ? `${d.material || "?"} · ${d.height_m || "?"} m`
          : "";
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700;font-size:13px">${n.name}</div>
            <div>Tipo: <b>${style.label || n.type}</b></div>
            ${detail ? `<div>${detail}</div>` : ""}
            ${n.notes ? `<div style="color:#555">${n.notes}</div>` : ""}
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
          label: { text: c.full_name || "Cliente", color: "#fff", fontSize: "9px" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 6,
            fillColor: "#22c55e", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 1,
          },
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
      let entry = cablePolylinesRef.current.get(cable.id);

      if (!entry) {
        const polyline = new google.maps.Polyline({
          path: cable.path.map((p) => ({ lat: p.lat, lng: p.lng })),
          strokeColor: style.color, strokeWeight: style.weight, editable: true, map,
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700">${style.label}</div>
            <div>Longitud: <b>${Number(cable.length_m || 0).toFixed(2)} m</b> · ${km(cable.length_m)} km</div>
            <div>Hilos: <b>${cable.fibers_count || 12}</b> (TIA-598)</div>
          </div>`,
        });
        polyline.addListener("click", (e) => info.setPosition(e.latLng) & info.open({ map }));
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
        entry.polyline.setOptions({ strokeColor: style.color, strokeWeight: style.weight });
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
              fillColor: style.color, fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 1,
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

  // Confirm cable
  const confirmCable = async (tipo, fibers) => {
    if (!pendingCable) return;
    const style = CABLE_STYLES[tipo];
    try {
      await api.post("/map/cables", {
        tipo, path: pendingCable.path, length_m: pendingCable.length,
        fibers_count: Number(fibers), color: style.color, weight: style.weight,
      });
      pendingCable.overlay.setMap(null);
      setPendingCable(null);
      toast.success(`Cable ${style.label} · ${fibers} hilos · ${pendingCable.length.toFixed(2)}m guardado`);
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
        />

        <div className="flex-1 rounded-md border border-border overflow-hidden bg-card relative"
             style={{ minHeight: 680 }} data-testid="mapa-container">
          <MapToolbar
            mode={mode}
            setMode={setMode}
            drawingVertexCount={drawingVertexCount}
            onFinishPolyline={finishPolyline}
            onCancelPolyline={cancelPolyline}
          />
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
      <JsonExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        data={exportPayload}
      />
      <MapConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        current={mapConfig}
        onSaved={(newKey) => {
          _mapsPromise = null;
          _mapsPromiseKey = null;
          if (window.google) delete window.google;
          setMapError(null);
          setReady(false);
          setMapConfig((c) => ({ ...(c || {}), api_key: newKey, has_key: true, api_key_masked: newKey.slice(0,4)+"•••"+newKey.slice(-4) }));
          setScriptReloadNonce((n) => n + 1);
          reload();
        }}
      />
    </div>
  );
}
