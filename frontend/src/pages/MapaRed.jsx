import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Boxes, Radio, Cable, Ruler, Download, Trash2, MapPin, Copy,
  MousePointer2, Waypoints, Server, Signal, Zap,
} from "lucide-react";
import { toast } from "sonner";

const GOOGLE_MAPS_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

/* Estilos de cables — deben aplicarse en tiempo real al terminar el trazo */
const CABLE_STYLES = {
  troncal:      { color: "#00d26a", weight: 6, label: "Troncal" },
  distribucion: { color: "#ef4444", weight: 4, label: "Distribución" },
};

// Cargador idempotente del script de Google Maps con drawing + geometry
let _mapsPromise = null;
function loadGoogleMaps() {
  if (window.google?.maps?.drawing && window.google?.maps?.geometry) {
    return Promise.resolve(window.google);
  }
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise((resolve, reject) => {
    if (!GOOGLE_MAPS_KEY) {
      reject(new Error("Falta REACT_APP_GOOGLE_MAPS_API_KEY en .env"));
      return;
    }
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}` +
      `&libraries=drawing,geometry&v=weekly`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps (revisa la API key)"));
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

/* ============================================================
   DIÁLOGO NAP · captura Nombre / Capacidad / Puertos ocupados
   ============================================================ */
function NapDialog({ open, onOpenChange, onConfirm, initial, coords }) {
  const [f, setF] = useState({ name: "", port_type: "1x16", used_ports: 0, notes: "" });
  useEffect(() => {
    if (open) {
      setF({
        name: initial?.name || "",
        port_type: initial?.port_type || "1x16",
        used_ports: initial?.used_ports ?? 0,
        notes: initial?.notes || "",
      });
    }
  }, [open, initial]);

  const submit = () => {
    if (!f.name.trim()) return toast.error("El nombre de la NAP es obligatorio");
    const capacity = f.port_type === "1x8" ? 8 : 16;
    const used = Math.max(0, Math.min(capacity, Number(f.used_ports || 0)));
    onConfirm({ ...f, name: f.name.trim(), used_ports: used, capacity });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !initial) onOpenChange(false); else onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-primary" />
            {initial ? "Editar NAP" : "Nueva NAP"}
          </DialogTitle>
          {coords && (
            <DialogDescription className="font-mono text-xs">
              📍 {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nombre de la NAP</Label>
            <Input data-testid="nap-name" value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ej: NAP-01 Reforma" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Capacidad</Label>
              <Select value={f.port_type} onValueChange={(v) => setF({ ...f, port_type: v })}>
                <SelectTrigger data-testid="nap-cap"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1x8">1:8 (8 puertos)</SelectItem>
                  <SelectItem value="1x16">1:16 (16 puertos)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Puertos ocupados</Label>
              <Input data-testid="nap-used" type="number" min="0"
                max={f.port_type === "1x8" ? 8 : 16}
                value={f.used_ports}
                onChange={(e) => setF({ ...f, used_ports: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} data-testid="nap-save">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   DIÁLOGO CABLE · elige tipo (Troncal / Distribución)
   ============================================================ */
function CableTypeDialog({ open, onOpenChange, lengthM, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="w-4 h-4 text-primary" /> Tipo de cable
          </DialogTitle>
          <DialogDescription>
            Longitud calculada: <span className="font-mono text-primary">{lengthM.toFixed(2)} m</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => onConfirm("troncal")}
            data-testid="cable-type-troncal"
            className="rounded-md border border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 p-4 text-left transition-colors"
          >
            <div className="w-full h-1.5 rounded-full mb-2" style={{ background: CABLE_STYLES.troncal.color }} />
            <div className="font-semibold text-emerald-400">Troncal</div>
            <div className="text-[11px] text-muted-foreground">Verde · 6px</div>
          </button>
          <button
            onClick={() => onConfirm("distribucion")}
            data-testid="cable-type-dist"
            className="rounded-md border border-red-500/50 bg-red-500/10 hover:bg-red-500/20 p-4 text-left transition-colors"
          >
            <div className="w-full h-1 rounded-full mb-2" style={{ background: CABLE_STYLES.distribucion.color }} />
            <div className="font-semibold text-red-400">Distribución</div>
            <div className="text-[11px] text-muted-foreground">Rojo · 4px</div>
          </button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Descartar cable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   PANEL LATERAL con estilo consola de telecomunicaciones
   ============================================================ */
function TelecomSidebar({ olts, naps, cables, totalM, onExport, onDeleteCable, onDeleteNap, mode, setMode, drawingVertexCount, onFinishPolyline, onCancelPolyline }) {
  return (
    <aside
      className="w-full lg:w-[320px] shrink-0 flex flex-col text-slate-200 border border-slate-700 rounded-md overflow-hidden"
      style={{ background: "#2c3e50" }}
      data-testid="mapa-sidebar"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-600 bg-black/20">
        <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-emerald-400 flex items-center gap-1">
          <Signal className="w-3 h-3" /> Consola FTTH · Red
        </div>
        <div className="text-sm font-mono mt-0.5">Plano en tiempo real</div>
      </div>

      {/* Herramientas */}
      <div className="p-3 border-b border-slate-600 space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Herramientas</div>
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => setMode("pan")}
            className={`rounded p-2 text-[11px] font-mono flex flex-col items-center gap-1 border ${
              mode === "pan" ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300" : "bg-slate-800/50 border-slate-600 hover:border-slate-500"
            }`}
            data-testid="mode-pan"
          >
            <MousePointer2 className="w-3.5 h-3.5" /> Mover
          </button>
          <button
            onClick={() => setMode("marker")}
            className={`rounded p-2 text-[11px] font-mono flex flex-col items-center gap-1 border ${
              mode === "marker" ? "bg-red-500/20 border-red-500/60 text-red-300" : "bg-slate-800/50 border-slate-600 hover:border-slate-500"
            }`}
            data-testid="mode-nap"
          >
            <MapPin className="w-3.5 h-3.5" /> NAP
          </button>
          <button
            onClick={() => setMode("polyline")}
            className={`rounded p-2 text-[11px] font-mono flex flex-col items-center gap-1 border ${
              mode === "polyline" ? "bg-sky-500/20 border-sky-500/60 text-sky-300" : "bg-slate-800/50 border-slate-600 hover:border-slate-500"
            }`}
            data-testid="mode-cable"
          >
            <Waypoints className="w-3.5 h-3.5" /> Cable
          </button>
        </div>
        <div className="text-[10px] text-slate-400 font-mono">
          Tip: Los vértices son arrastrables (editable: true).
        </div>
      </div>

      {/* Stats */}
      <div className="p-3 border-b border-slate-600 grid grid-cols-3 gap-2">
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-blue-400"><Server className="w-3 h-3 inline mr-0.5" />OLT</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-olts">{olts.length}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-red-400"><Boxes className="w-3 h-3 inline mr-0.5" />NAP</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-naps">{naps.length}</div>
        </div>
        <div className="rounded bg-black/30 p-2">
          <div className="text-[9px] font-mono uppercase text-emerald-400"><Cable className="w-3 h-3 inline mr-0.5" />CAB</div>
          <div className="text-lg font-mono font-bold" data-testid="stat-cables">{cables.length}</div>
        </div>
      </div>

      <div className="p-3 border-b border-slate-600">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1">
          <Ruler className="w-3 h-3" /> Fibra tendida total
        </div>
        <div className="mt-1 font-mono text-2xl text-emerald-300" data-testid="stat-total-m">
          {totalM.toFixed(2)} m
        </div>
        <div className="text-[10px] text-slate-400 font-mono">
          {(totalM / 1000).toFixed(3)} km · computeLength() esférico
        </div>
      </div>

      {/* Listado de elementos */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[240px] max-h-[380px] lg:max-h-none">
        {cables.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono mb-1">Cables</div>
            <ul className="space-y-1">
              {cables.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded p-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: CABLE_STYLES[c.tipo]?.color }} />
                  <span className="flex-1 truncate">{CABLE_STYLES[c.tipo]?.label}</span>
                  <span className="text-emerald-300">{Number(c.length_m).toFixed(1)}m</span>
                  <button
                    onClick={() => onDeleteCable(c.id)}
                    className="p-0.5 rounded hover:bg-red-500/20"
                    title="Eliminar cable"
                    data-testid={`del-cable-${c.id}`}
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {naps.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono mb-1">NAPs</div>
            <ul className="space-y-1">
              {naps.map((n) => (
                <li key={n.id} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded p-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="flex-1 truncate">{n.name}</span>
                  <span className="text-slate-400 text-[10px]">{n.used_ports || 0}/{n.capacity}</span>
                  <button
                    onClick={() => onDeleteNap(n.id)}
                    className="p-0.5 rounded hover:bg-red-500/20"
                    title="Eliminar NAP"
                    data-testid={`del-nap-${n.id}`}
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {olts.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono mb-1">OLTs</div>
            <ul className="space-y-1">
              {olts.map((o) => (
                <li key={o.id} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded p-1.5">
                  <Server className="w-3 h-3 text-blue-400" />
                  <span className="flex-1 truncate">{o.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Botón exportar */}
      <div className="p-3 border-t border-slate-600 bg-black/30 space-y-2">
        {drawingVertexCount > 0 && (
          <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-sky-300 font-mono">
              Cable en trazado · {drawingVertexCount} vértices
            </div>
            <div className="flex gap-1">
              <button
                onClick={onFinishPolyline}
                disabled={drawingVertexCount < 2}
                className="flex-1 text-[11px] font-mono uppercase tracking-widest rounded bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400 text-white py-1.5"
                data-testid="finish-cable-btn"
              >
                Terminar cable
              </button>
              <button
                onClick={onCancelPolyline}
                className="text-[11px] font-mono uppercase tracking-widest rounded border border-slate-500 hover:border-red-400 hover:text-red-300 py-1.5 px-2"
                data-testid="cancel-cable-btn"
              >
                <Trash2 className="w-3 h-3 inline" />
              </button>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Doble-click en el mapa también termina el cable.
            </div>
          </div>
        )}
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
   DIÁLOGO JSON — resultado del export
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
          <DialogDescription>
            Estructura lista para pasar al modelo (optimización de rutas, atenuación por distancia, auditorías).
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-black/60 text-emerald-300 font-mono text-xs p-3 rounded max-h-[420px] overflow-auto whitespace-pre">
          {text}
        </pre>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(text);
              toast.success("JSON copiado");
            }}
            data-testid="copy-json-btn"
          >
            <Copy className="w-4 h-4 mr-1" /> Copiar
          </Button>
          <Button
            onClick={() => {
              const blob = new Blob([text], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `plano-red-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            data-testid="download-json-btn"
          >
            <Download className="w-4 h-4 mr-1" /> Descargar .json
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   PÁGINA
   ============================================================ */
export default function MapaRed() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const modeRef = useRef("pan");
  const drawingRef = useRef({ polyline: null, path: [] }); // in-progress polyline
  const napMarkersRef = useRef(new Map());
  const oltMarkersRef = useRef(new Map());
  const cablePolylinesRef = useRef(new Map());

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [olts, setOlts] = useState([]);
  const [naps, setNaps] = useState([]);
  const [cables, setCables] = useState([]);
  const [mode, setModeState] = useState("pan");
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);

  const setMode = useCallback((m) => {
    modeRef.current = m;
    setModeState(m);
  }, []);

  const [pendingNap, setPendingNap] = useState(null);
  const [pendingCable, setPendingCable] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const totalM = useMemo(
    () => cables.reduce((a, c) => a + Number(c.length_m || 0), 0),
    [cables]
  );

  // ---- Data loading ----
  const reload = useCallback(async () => {
    try {
      const [napsRes, cablesRes, oltsRes] = await Promise.all([
        api.get("/nap-boxes"),
        api.get("/map/cables"),
        api.get("/devices").catch(() => ({ data: [] })),
      ]);
      setNaps(napsRes.data);
      setCables(cablesRes.data);
      // Filter for OLT-type devices that have coordinates
      const oltList = (oltsRes.data || []).filter(
        (d) => (d.type === "olt" || d.kind === "olt" || d.name?.toLowerCase().includes("olt"))
              && d.lat != null && d.lng != null
      );
      setOlts(oltList);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // ---- Google Maps init ----
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled) return;
      if (!containerRef.current) {
        setTimeout(() => {
          if (!containerRef.current || mapRef.current) return;
          initMap(google);
        }, 200);
        return;
      }
      initMap(google);
    }).catch((e) => {
      console.error("[MapaRed] loadGoogleMaps rejected:", e);
      setMapError(e.message);
      toast.error(e.message);
    });

    function initMap(google) {
      try {
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 19.4326, lng: -99.1332 },
          zoom: 13,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          disableDoubleClickZoom: true,
          mapTypeId: "roadmap",
          styles: [
            { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;

        window.gm_authFailure = () => {
          setMapError(
            "Google Maps rechazó la API key (InvalidKeyMapError). " +
            "Habilita 'Maps JavaScript API' + billing y añade este dominio a las restricciones de referrer."
          );
        };

        setReady(true);
      } catch (err) {
        console.error("[MapaRed] initMap threw:", err);
        setMapError("Error inicializando el mapa: " + err.message);
      }
    }

    return () => { cancelled = true; };
  }, []);

  // ---- Manual drawing (DrawingManager was removed from Maps JS v3.65) ----
  useEffect(() => {
    if (!ready) return;
    const google = window.google;
    const map = mapRef.current;
    if (!map || !google) return;

    const clickListener = map.addListener("click", (e) => {
      const m = modeRef.current;
      if (m === "marker") {
        // Add a temporary visual marker until the user confirms via dialog
        const marker = new google.maps.Marker({
          position: e.latLng,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8, fillColor: "#ef4444", fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 2,
          },
        });
        setPendingNap({
          overlay: marker,
          coords: { lat: e.latLng.lat(), lng: e.latLng.lng() },
        });
        setMode("pan");
      } else if (m === "polyline") {
        if (!drawingRef.current.polyline) {
          const poly = new google.maps.Polyline({
            path: [e.latLng],
            strokeColor: "#38bdf8",
            strokeWeight: 4,
            editable: false,
            map,
          });
          drawingRef.current = {
            polyline: poly,
            path: [{ lat: e.latLng.lat(), lng: e.latLng.lng() }],
          };
        } else {
          drawingRef.current.polyline.getPath().push(e.latLng);
          drawingRef.current.path.push({
            lat: e.latLng.lat(), lng: e.latLng.lng(),
          });
        }
        setDrawingVertexCount(drawingRef.current.path.length);
      }
    });

    const dblListener = map.addListener("dblclick", () => {
      if (drawingRef.current.polyline && drawingRef.current.path.length >= 2) {
        finishPolyline();
      }
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(dblListener);
    };
  }, [ready, setMode]);

  // ---- Finish an in-progress polyline (called from dblclick or sidebar btn) ----
  const finishPolyline = useCallback(() => {
    const google = window.google;
    const draft = drawingRef.current;
    if (!google || !draft.polyline || draft.path.length < 2) return;
    const lengthM = google.maps.geometry.spherical.computeLength(draft.polyline.getPath());
    setPendingCable({
      overlay: draft.polyline,
      path: draft.path.slice(),
      length: lengthM,
    });
    drawingRef.current = { polyline: null, path: [] };
    setDrawingVertexCount(0);
    setMode("pan");
  }, [setMode]);

  const cancelPolyline = useCallback(() => {
    const draft = drawingRef.current;
    if (draft.polyline) draft.polyline.setMap(null);
    drawingRef.current = { polyline: null, path: [] };
    setDrawingVertexCount(0);
  }, []);

  // ---- Change cursor / drawing mode indicator ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "marker" || mode === "polyline") {
      map.setOptions({ draggableCursor: "crosshair" });
    } else {
      map.setOptions({ draggableCursor: null });
      // If leaving polyline mode with an in-progress polyline, discard it
      if (drawingRef.current.polyline && mode !== "polyline") {
        cancelPolyline();
      }
    }
  }, [mode, cancelPolyline]);

  // ---- Render / sync NAP markers ----
  useEffect(() => {
    const google = window.google;
    if (!ready || !google) return;
    const seen = new Set();
    const map = mapRef.current;

    for (const nap of naps) {
      seen.add(nap.id);
      let entry = napMarkersRef.current.get(nap.id);
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: nap.lat, lng: nap.lng },
          map,
          draggable: true,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8, fillColor: "#ef4444", fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 2,
          },
        });
        const infoContent = () => `
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#111">
            <div style="font-weight:700;font-size:13px">${nap.name}</div>
            <div>Tipo: <b>NAP ${nap.port_type || "1x16"}</b></div>
            <div>Puertos: <b>${nap.used_ports || 0}/${nap.capacity}</b></div>
            <div>Lat/Lng: ${nap.lat.toFixed(6)}, ${nap.lng.toFixed(6)}</div>
          </div>`;
        const info = new google.maps.InfoWindow({ content: infoContent() });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        marker.addListener("dragend", async () => {
          const p = marker.getPosition();
          try {
            await api.patch(`/nap-boxes/${nap.id}`, { lat: p.lat(), lng: p.lng() });
            toast.success(`NAP "${nap.name}" reubicada`);
            reload();
          } catch (e) { toast.error(formatApiError(e)); }
        });
        entry = { marker, info };
        napMarkersRef.current.set(nap.id, entry);
      }
    }
    // Cleanup removed
    for (const [id, entry] of napMarkersRef.current.entries()) {
      if (!seen.has(id)) {
        entry.marker.setMap(null);
        napMarkersRef.current.delete(id);
      }
    }
  }, [naps, ready, reload]);

  // ---- Render / sync OLT markers ----
  useEffect(() => {
    const google = window.google;
    if (!ready || !google) return;
    const seen = new Set();
    const map = mapRef.current;
    for (const olt of olts) {
      if (olt.lat == null || olt.lng == null) continue;
      seen.add(olt.id);
      let entry = oltMarkersRef.current.get(olt.id);
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: olt.lat, lng: olt.lng },
          map,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 6, fillColor: "#3b82f6", fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 2,
          },
          zIndex: 1000,
        });
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:ui-monospace;font-size:12px;color:#111">
            <div style="font-weight:700">${olt.name}</div>
            <div>Tipo: <b>OLT Central</b></div>
            <div>${olt.host || ""}${olt.community ? " · " + olt.community : ""}</div>
          </div>`,
        });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        entry = { marker, info };
        oltMarkersRef.current.set(olt.id, entry);
      }
    }
    for (const [id, entry] of oltMarkersRef.current.entries()) {
      if (!seen.has(id)) {
        entry.marker.setMap(null);
        oltMarkersRef.current.delete(id);
      }
    }
  }, [olts, ready]);

  // ---- Render / sync cable polylines ----
  useEffect(() => {
    const google = window.google;
    if (!ready || !google) return;
    const seen = new Set();
    const map = mapRef.current;
    for (const cable of cables) {
      seen.add(cable.id);
      const style = CABLE_STYLES[cable.tipo] || CABLE_STYLES.distribucion;
      let entry = cablePolylinesRef.current.get(cable.id);
      if (!entry) {
        const polyline = new google.maps.Polyline({
          path: cable.path.map((p) => ({ lat: p.lat, lng: p.lng })),
          strokeColor: style.color,
          strokeWeight: style.weight,
          editable: true,
          map,
        });
        // Recompute length + persist on edit
        const path = polyline.getPath();
        const onEdit = async () => {
          const newPath = [];
          path.forEach((p) => newPath.push({ lat: p.lat(), lng: p.lng() }));
          const newLen = google.maps.geometry.spherical.computeLength(path);
          try {
            await api.patch(`/map/cables/${cable.id}`, { path: newPath, length_m: newLen });
          } catch (e) { /* silent, will re-sync on next reload */ }
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
        entry.polyline.setOptions({
          strokeColor: style.color,
          strokeWeight: style.weight,
        });
      }
    }
    for (const [id, entry] of cablePolylinesRef.current.entries()) {
      if (!seen.has(id)) {
        entry.polyline.setMap(null);
        cablePolylinesRef.current.delete(id);
      }
    }
  }, [cables, ready]);

  // ---- Save NAP confirm ----
  const confirmNap = async (form) => {
    if (!pendingNap) return;
    try {
      const { data } = await api.post("/nap-boxes", {
        name: form.name,
        port_type: form.port_type,
        lat: pendingNap.coords.lat,
        lng: pendingNap.coords.lng,
        notes: form.notes,
      });
      // Persist used_ports separately since NapBoxIn doesn't have it — patch
      if (form.used_ports > 0) {
        try { await api.patch(`/nap-boxes/${data.id}`, { used_ports: form.used_ports }); } catch {}
      }
      pendingNap.overlay.setMap(null); // remove temporary marker (server-synced one will appear)
      setPendingNap(null);
      toast.success(`NAP "${form.name}" creada`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e));
      pendingNap.overlay.setMap(null);
      setPendingNap(null);
    }
  };
  const discardNap = () => {
    if (pendingNap) {
      pendingNap.overlay.setMap(null);
      setPendingNap(null);
    }
  };

  // ---- Save cable confirm ----
  const confirmCable = async (tipo) => {
    if (!pendingCable) return;
    const style = CABLE_STYLES[tipo];
    try {
      await api.post("/map/cables", {
        tipo,
        path: pendingCable.path,
        length_m: pendingCable.length,
        color: style.color,
        weight: style.weight,
      });
      pendingCable.overlay.setMap(null); // let sync effect re-create with correct style
      setPendingCable(null);
      toast.success(`Cable ${style.label} · ${pendingCable.length.toFixed(2)} m guardado`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };
  const discardCable = () => {
    if (pendingCable) {
      pendingCable.overlay.setMap(null);
      setPendingCable(null);
    }
  };

  const deleteCable = async (id) => {
    if (!window.confirm("¿Eliminar este cable?")) return;
    try { await api.delete(`/map/cables/${id}`); toast.success("Cable eliminado"); reload(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const deleteNap = async (id) => {
    if (!window.confirm("¿Eliminar esta NAP?")) return;
    try { await api.delete(`/nap-boxes/${id}`); toast.success("NAP eliminada"); reload(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  // ---- JSON export for AI ----
  const exportJson = () => {
    const nodos = [
      ...olts.filter((o) => o.lat != null && o.lng != null).map((o, i) => ({
        id: `olt-${o.id}`,
        idx: i + 1,
        tipo: "OLT",
        lat: o.lat,
        lng: o.lng,
        info: { nombre: o.name, host: o.host || "", community: o.community || "" },
      })),
      ...naps.map((n, i) => ({
        id: `nap-${n.id}`,
        idx: olts.length + i + 1,
        tipo: "NAP",
        lat: n.lat,
        lng: n.lng,
        info: {
          nombre: n.name,
          capacidad: n.port_type || "1x16",
          puertos_ocupados: n.used_ports || 0,
          capacidad_total: n.capacity,
        },
      })),
    ];
    const cablesOut = cables.map((c, i) => ({
      id: `cable-${c.id}`,
      idx: i + 1,
      tipo: c.tipo === "troncal" ? "Troncal" : "Distribución",
      longitud_metros: Number(c.length_m || 0).toFixed(2),
      ruta_coordenadas: c.path,
    }));
    setExportPayload({
      generado_en: new Date().toISOString(),
      resumen: {
        olts: olts.length,
        naps: naps.length,
        cables: cables.length,
        fibra_total_metros: totalM.toFixed(2),
        fibra_total_km: (totalM / 1000).toFixed(3),
      },
      nodos,
      cables: cablesOut,
    });
    setExportOpen(true);
  };
  const [exportPayload, setExportPayload] = useState({ nodos: [], cables: [] });

  return (
    <div>
      <PageHeader
        title="Mapa de servicio"
        subtitle="Traza tu red FTTH sobre Google Maps con herramientas de dibujo. Cada trazo mide su longitud en metros y todo se guarda en tiempo real para exportar a la IA."
      />

      {!GOOGLE_MAPS_KEY && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500 mb-3">
          Falta <code className="font-mono">REACT_APP_GOOGLE_MAPS_API_KEY</code> en <code>/app/frontend/.env</code>.
        </div>
      )}

      {mapError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm mb-3">
          <div className="font-semibold text-amber-500 mb-1">⚠ {mapError.split("(")[0]}</div>
          <div className="text-xs text-muted-foreground">
            Ve a{" "}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
               className="underline text-primary">Google Cloud Console → APIs & credentials</a>, edita tu key y:
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              <li>Habilita <span className="font-mono">Maps JavaScript API</span> + billing en el proyecto</li>
              <li>En "Application restrictions" agrega:
                <code className="font-mono ml-1">https://customer-net-ops.preview.emergentagent.com/*</code>
                {" "}y <code className="font-mono">https://jupiterisp.net/*</code></li>
              <li>En "API restrictions" permite <span className="font-mono">Maps JavaScript API</span></li>
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3">
        <TelecomSidebar
          olts={olts}
          naps={naps}
          cables={cables}
          totalM={totalM}
          onExport={exportJson}
          onDeleteCable={deleteCable}
          onDeleteNap={deleteNap}
          mode={mode}
          setMode={setMode}
          drawingVertexCount={drawingVertexCount}
          onFinishPolyline={finishPolyline}
          onCancelPolyline={cancelPolyline}
        />

        <div className="flex-1 rounded-md border border-border overflow-hidden bg-card"
             style={{ minHeight: 620 }} data-testid="mapa-container">
          <div ref={containerRef} style={{ width: "100%", height: 620 }} />
        </div>
      </div>

      {/* Leyenda inferior */}
      <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#3b82f6" }} /> OLT Central</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#ef4444" }} /> Caja NAP</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-6 h-1 rounded" style={{ background: "#00d26a" }} /> Cable Troncal (6px)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-6 h-0.5 rounded" style={{ background: "#ef4444" }} /> Cable Distribución (4px)</span>
        <Badge variant="outline" className="ml-auto text-[10px] font-mono">
          libs: drawing · geometry · computeLength()
        </Badge>
      </div>

      {/* Diálogos */}
      <NapDialog
        open={!!pendingNap}
        onOpenChange={(v) => { if (!v) discardNap(); }}
        onConfirm={confirmNap}
        coords={pendingNap?.coords}
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
    </div>
  );
}
