import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import {
  Wifi, WifiOff, LogOut, Upload, CheckCircle2, CreditCard,
  Activity, Signal, Calendar, Phone, LogIn as LogInIcon,
} from "lucide-react";

const PORTAL_API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const portalApi = axios.create({ baseURL: PORTAL_API, withCredentials: true });

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(iso).slice(0, 10); }
}

function daysUntil(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const diff = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return Math.round(diff);
  } catch { return null; }
}

const STATUS_MAP = {
  active: { label: "Activo", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", icon: CheckCircle2 },
  suspended: { label: "Suspendido", cls: "bg-red-500/15 text-red-300 border-red-500/40", icon: WifiOff },
  offline: { label: "Sin conexión", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", icon: WifiOff },
  new: { label: "Nuevo", cls: "bg-sky-500/15 text-sky-300 border-sky-500/40", icon: Wifi },
};

/* --------------- LOGIN --------------- */
function PortalLogin({ onLoggedIn }) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.trim().length < 4) { toast.error("Ingresa tu PIN"); return; }
    setLoading(true);
    try {
      const { data } = await portalApi.post("/portal/login", { pin: pin.trim() });
      toast.success(`Hola ${data.client.full_name?.split(" ")[0] || ""}!`);
      onLoggedIn(data.client);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "PIN inválido");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-gradient-to-br from-slate-950 via-slate-900 to-black">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 grid place-items-center">
            <Wifi className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Portal cliente</div>
            <div className="font-display font-bold text-lg text-white">EnlaceHR ISP</div>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Bienvenido</h1>
        <p className="text-sm text-slate-400 mb-5">Ingresa tu PIN de 6 dígitos para acceder a tu servicio.</p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label className="text-slate-300 text-xs uppercase tracking-widest font-mono">PIN de 6 dígitos</Label>
            <Input
              data-testid="portal-pin"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              className="mt-1 bg-slate-950/50 border-slate-700 text-white tracking-widest text-center font-mono text-2xl h-14"
              required
            />
          </div>
          <Button type="submit" disabled={loading || pin.length < 4} data-testid="portal-login-btn" className="w-full bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-90 text-white font-semibold h-11">
            <LogInIcon className="w-4 h-4 mr-2" />
            {loading ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>
        <p className="text-[11px] text-slate-500 mt-4 text-center">
          ¿No tienes tu PIN? Contacta a soporte por WhatsApp.
        </p>

        <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-center">
          <Link
            to="/login"
            data-testid="portal-staff-login-link"
            className="text-[11px] font-mono uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
          >
            ¿Eres operador? Ir al panel →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* --------------- DASHBOARD --------------- */
function PortalDashboard({ initialClient, onLogout }) {
  const [me, setMe] = useState({ client: initialClient, plan: null });
  const [payments, setPayments] = useState([]);
  const [onu, setOnu] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [notes, setNotes] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [meR, payR, onuR] = await Promise.all([
        portalApi.get("/portal/me"),
        portalApi.get("/portal/payments"),
        portalApi.get("/portal/onu"),
      ]);
      setMe(meR.data);
      setPayments(payR.data);
      setOnu(onuR.data);
    } catch (e) {
      if (e?.response?.status === 401) onLogout();
      else toast.error(e?.response?.data?.detail || "Error cargando datos");
    }
  }, [onLogout]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    const t = setInterval(async () => {
      try { const { data } = await portalApi.get("/portal/onu"); setOnu(data); } catch (_) {}
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const uploadReceipt = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Selecciona una imagen"); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Máximo 4 MB"); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const params = { method };
      if (amount) params.amount = amount;
      if (notes) params.notes = notes;
      const { data } = await portalApi.post("/portal/payments/upload", form, {
        params,
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`¡Servicio activado! Próximo pago: ${fmtDate(data.new_due_date)}`);
      if (fileRef.current) fileRef.current.value = "";
      setAmount(""); setNotes("");
      loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo subir el comprobante");
    } finally { setUploading(false); }
  };

  const doLogout = async () => {
    try { await portalApi.post("/portal/logout"); } catch (_) {}
    onLogout();
  };

  const client = me.client || initialClient;
  const plan = me.plan;
  const status = STATUS_MAP[client?.status] || STATUS_MAP.new;
  const StatusIcon = status.icon;
  const daysLeft = daysUntil(client?.next_due_date);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-slate-100">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-slate-950/70 border-b border-slate-800">
        <div className="max-w-3xl mx-auto flex items-center gap-3 p-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 grid place-items-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Portal cliente</div>
            <div className="font-semibold truncate">{client?.full_name}</div>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={doLogout}
            data-testid="portal-logout"
            className="ml-auto text-slate-300 hover:text-white"
          >
            <LogOut className="w-4 h-4 mr-1" /> Salir
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {/* Status hero card */}
        <div className={`rounded-xl border p-5 ${client?.status === "active" ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/10 border-red-500/40"}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-300 font-mono mb-1">Estado del servicio</div>
              <div className="flex items-center gap-2 text-2xl font-bold">
                <StatusIcon className="w-6 h-6" /> {status.label}
              </div>
              {plan && (
                <div className="mt-1 text-sm text-slate-300">Plan: <b>{plan.name}</b> · {plan.speed_mbps} Mbps</div>
              )}
            </div>
            <Badge variant="outline" className={`${status.cls} text-xs`}>{status.label}</Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1"><Calendar className="w-3 h-3" /> Próximo pago</div>
              <div className="mt-1 font-semibold text-white">{fmtDate(client?.next_due_date)}</div>
              {daysLeft !== null && (
                <div className={`text-[11px] mt-0.5 ${daysLeft < 0 ? "text-red-300" : daysLeft <= 3 ? "text-amber-300" : "text-slate-400"}`}>
                  {daysLeft < 0 ? `Vencido hace ${-daysLeft} días` : daysLeft === 0 ? "Vence hoy" : `Faltan ${daysLeft} días`}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1"><CreditCard className="w-3 h-3" /> Monto</div>
              <div className="mt-1 font-semibold text-white">{plan ? `$${plan.price}` : "—"}</div>
              <div className="text-[11px] mt-0.5 text-slate-400">mensualidad</div>
            </div>
          </div>
        </div>

        {/* Live consumption */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Consumo en vivo</div>
            <div className={`ml-auto flex items-center gap-1.5 text-[11px] font-mono ${onu?.online ? "text-emerald-400" : "text-red-400"}`}>
              <span className={`w-2 h-2 rounded-full ${onu?.online ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              {onu?.online ? "En línea" : "Sin conexión"}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-md bg-slate-950/50 border border-slate-800 p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Descarga</div>
              <div className="mt-1 font-bold text-emerald-300 text-lg" data-testid="portal-rx">{onu?.rx_mbps ?? "—"}</div>
              <div className="text-[10px] text-slate-500">Mbps</div>
            </div>
            <div className="rounded-md bg-slate-950/50 border border-slate-800 p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Subida</div>
              <div className="mt-1 font-bold text-sky-300 text-lg" data-testid="portal-tx">{onu?.tx_mbps ?? "—"}</div>
              <div className="text-[10px] text-slate-500">Mbps</div>
            </div>
            <div className="rounded-md bg-slate-950/50 border border-slate-800 p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Potencia</div>
              <div className="mt-1 font-bold text-amber-300 text-lg" data-testid="portal-power">{onu?.power_dbm ?? "—"}</div>
              <div className="text-[10px] text-slate-500">dBm</div>
            </div>
          </div>
          {onu?.series?.length > 0 && (
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={onu.series}>
                  <defs>
                    <linearGradient id="rxG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#7dd3fc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={4} />
                  <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} width={26} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 11 }} />
                  <Area type="monotone" dataKey="rx" stroke="#34d399" fill="url(#rxG)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="tx" stroke="#7dd3fc" fill="url(#txG)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Payment upload */}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-4 h-4 text-amber-400" />
            <div className="text-sm font-semibold">Subir comprobante y activar servicio</div>
          </div>
          <p className="text-xs text-slate-400 mb-3">Sube la foto de tu pago (transferencia o efectivo). Tu servicio se activará al instante.</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Monto</Label>
              <Input
                data-testid="portal-amount"
                type="number" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="mt-1 bg-slate-950/50 border-slate-800 h-9"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Método</Label>
              <select
                data-testid="portal-method"
                value={method} onChange={(e) => setMethod(e.target.value)}
                className="mt-1 h-9 w-full rounded-md bg-slate-950/50 border border-slate-800 px-2 text-sm text-slate-100"
              >
                <option value="transfer">Transferencia</option>
                <option value="cash">Efectivo</option>
                <option value="other">Otro</option>
              </select>
            </div>
          </div>
          <div className="mb-3">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Nota (opcional)</Label>
            <Input
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Referencia, banco, etc"
              className="mt-1 bg-slate-950/50 border-slate-800 h-9"
              data-testid="portal-notes"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="text-xs text-slate-300 mb-3"
            data-testid="portal-file-input"
          />
          <Button
            onClick={uploadReceipt}
            disabled={uploading}
            data-testid="portal-upload-btn"
            className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {uploading ? "Subiendo y activando…" : "Subir y activar servicio"}
          </Button>
        </div>

        {/* Payment history */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Signal className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Historial de pagos</div>
          </div>
          {payments.length === 0 && <div className="text-xs text-slate-500 py-4 text-center">Aún no hay pagos registrados.</div>}
          <div className="space-y-2">
            {payments.slice(0, 10).map((p) => {
              const s = p.status || "pending_review";
              const chipCls = s === "accepted"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                : s === "rejected"
                  ? "bg-red-500/15 text-red-300 border-red-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40";
              const chipLbl = s === "accepted" ? "Aceptado" : s === "rejected" ? "Rechazado" : "Por revisar";
              return (
                <div key={p.id} className="p-2 rounded-md bg-slate-950/40 border border-slate-800" data-testid={`portal-payment-${p.id}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${s === "accepted" ? "bg-emerald-400" : s === "rejected" ? "bg-red-400" : "bg-amber-400"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{p.concept || "Pago"}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{fmtDate(p.created_at)} · {p.method}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-300">${p.amount}</div>
                      <span className={`inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded border font-mono ${chipCls}`}>{chipLbl}</span>
                    </div>
                  </div>
                  {p.review_notes && (
                    <div className="mt-1.5 text-[10px] text-slate-400 pl-5 border-l-2 border-slate-700">
                      <span className="font-mono">Nota{p.reviewed_by_name ? ` de ${p.reviewed_by_name}` : ""}:</span> {p.review_notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-center text-[11px] text-slate-600 py-4 font-mono">
          Portal EnlaceHR ISP · v1.0
        </div>
      </main>
      <Toaster theme="dark" position="top-center" />
    </div>
  );
}

/* --------------- ROUTER --------------- */
export default function ClientPortal() {
  const [client, setClient] = useState(null);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await portalApi.get("/portal/me");
        setClient(data.client);
      } catch (_) { /* not logged in */ }
      setChecked(true);
    })();
  }, []);

  if (!checked) return <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-400">Cargando…</div>;

  return (
    <Routes>
      <Route path="/" element={
        client
          ? <PortalDashboard initialClient={client} onLogout={() => { setClient(null); navigate("/portal"); }} />
          : <PortalLogin onLoggedIn={(c) => setClient(c)} />
      } />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  );
}
