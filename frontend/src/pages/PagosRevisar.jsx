import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  HandCoins, CheckCircle2, XCircle, Clock, RefreshCw, Eye, Phone, Calendar, FileImage, AlertTriangle, User,
} from "lucide-react";
import { toast } from "sonner";

function fmt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(iso).slice(0, 10); }
}
function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

const STATUS = {
  pending_review: { label: "Por revisar", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", icon: Clock },
  accepted:       { label: "Aceptado",    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", icon: CheckCircle2 },
  rejected:       { label: "Rechazado",   cls: "bg-red-500/15 text-red-300 border-red-500/40",           icon: XCircle },
};

function PaymentCard({ p, onReview }) {
  const S = STATUS[p.status] || STATUS.pending_review;
  const Icon = S.icon;
  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid={`review-card-${p.id}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onReview(p, "preview")}
          className="w-20 h-20 rounded-md border border-border bg-slate-950 grid place-items-center shrink-0 hover:ring-2 hover:ring-primary/40 transition-all overflow-hidden"
          data-testid={`review-preview-${p.id}`}
        >
          {p.receipt_url ? (
            <img src={p.receipt_url} alt="comprobante" className="w-full h-full object-cover" />
          ) : (
            <FileImage className="w-6 h-6 text-muted-foreground" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{p.client_full_name || "Cliente"}</div>
            <Badge variant="outline" className={`text-[10px] gap-1 ${S.cls}`}>
              <Icon className="w-3 h-3" /> {S.label}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-2 mt-0.5">
            {p.client_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{p.client_phone}</span>}
            <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmt(p.created_at)} {fmtTime(p.created_at)}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Monto</div>
              <div className="font-bold text-emerald-300">${p.amount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Método</div>
              <div className="capitalize">{p.method || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Nota cliente</div>
              <div className="truncate">{p.notes || "—"}</div>
            </div>
          </div>
          {p.review_notes && (
            <div className="mt-2 text-[11px] rounded bg-secondary/40 border border-border px-2 py-1">
              <span className="font-mono text-muted-foreground">Nota admin ({p.reviewed_by_name || "—"}):</span> {p.review_notes}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => onReview(p, "preview")} data-testid={`review-view-${p.id}`}>
              <Eye className="w-3 h-3 mr-1" /> Ver comprobante
            </Button>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => onReview(p, "accepted")} data-testid={`review-accept-${p.id}`}>
              <CheckCircle2 className="w-3 h-3 mr-1" /> Aceptar
            </Button>
            <Button size="sm" variant="outline" onClick={() => onReview(p, "pending_review")} data-testid={`review-pending-${p.id}`}>
              <Clock className="w-3 h-3 mr-1" /> Pendiente
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onReview(p, "rejected")} data-testid={`review-reject-${p.id}`}>
              <XCircle className="w-3 h-3 mr-1" /> Rechazar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PagosRevisar() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [action, setAction] = useState(null);      // "accepted" | "rejected" | "pending_review" | "preview"
  const [note, setNote] = useState("");
  const [rollback, setRollback] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/payments/pending-review");
      setItems(data);
    } catch (e) { toast.error(formatApiError(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => ({
    pending_review: items.filter((p) => p.status === "pending_review"),
    accepted: items.filter((p) => p.status === "accepted"),
    rejected: items.filter((p) => p.status === "rejected"),
  }), [items]);

  const openReview = (p, act) => {
    setActive(p);
    setAction(act);
    setNote(p.review_notes || "");
    setRollback(false);
  };

  const closeReview = () => { setActive(null); setAction(null); setNote(""); };

  const submitReview = async () => {
    if (!active || !action || action === "preview") return;
    try {
      await api.patch(`/payments/${active.id}/review`, {
        status: action,
        review_notes: note.trim(),
        rollback_extension: action === "rejected" ? rollback : false,
      });
      toast.success(`Pago ${STATUS[action].label.toLowerCase()}. El cliente lo verá en su portal.`);
      closeReview();
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title="Pagos a revisar"
        subtitle="Comprobantes que subieron los clientes desde su portal. Acepta o rechaza y el estado se sincroniza en su portal automáticamente."
        actions={
          <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="review-refresh">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refrescar
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-[11px] uppercase tracking-widest text-amber-300 font-mono">Por revisar</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-amber-300" data-testid="kpi-pending">{grouped.pending_review.length}</div>
        </div>
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="text-[11px] uppercase tracking-widest text-emerald-300 font-mono">Aceptados</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-300" data-testid="kpi-accepted">{grouped.accepted.length}</div>
        </div>
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4">
          <div className="text-[11px] uppercase tracking-widest text-red-300 font-mono">Rechazados</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-red-300" data-testid="kpi-rejected">{grouped.rejected.length}</div>
        </div>
      </div>

      <Tabs defaultValue="pending_review">
        <TabsList data-testid="review-tabs">
          <TabsTrigger value="pending_review" data-testid="tab-pending">Por revisar ({grouped.pending_review.length})</TabsTrigger>
          <TabsTrigger value="accepted" data-testid="tab-accepted">Aceptados ({grouped.accepted.length})</TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">Rechazados ({grouped.rejected.length})</TabsTrigger>
          <TabsTrigger value="all">Todos ({items.length})</TabsTrigger>
        </TabsList>

        {["pending_review", "accepted", "rejected", "all"].map((k) => (
          <TabsContent key={k} value={k} className="mt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {(k === "all" ? items : grouped[k]).length === 0 && (
                <div className="col-span-full text-center text-muted-foreground py-10 text-sm border border-dashed border-border rounded-md">
                  <HandCoins className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  {k === "pending_review" ? "No hay pagos por revisar." : `No hay pagos ${k === "accepted" ? "aceptados" : "rechazados"}.`}
                </div>
              )}
              {(k === "all" ? items : grouped[k]).map((p) => (
                <PaymentCard key={p.id} p={p} onReview={openReview} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Review action dialog */}
      <Dialog open={!!active} onOpenChange={(v) => !v && closeReview()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {action === "preview" ? <><Eye className="w-4 h-4" /> Comprobante</>
                : action === "accepted" ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Aceptar pago</>
                : action === "rejected" ? <><XCircle className="w-4 h-4 text-red-400" /> Rechazar pago</>
                : <><Clock className="w-4 h-4 text-amber-400" /> Marcar como pendiente</>}
            </DialogTitle>
            {active && (
              <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                <User className="w-3 h-3" /> <b className="text-foreground">{active.client_full_name}</b>
                <span className="text-xs">·</span>
                <span className="text-xs font-mono">${active.amount} · {active.method}</span>
                <span className="text-xs">·</span>
                <span className="text-xs">{fmt(active.created_at)} {fmtTime(active.created_at)}</span>
              </DialogDescription>
            )}
          </DialogHeader>

          {active?.receipt_url && (
            <div className="rounded-md border border-border bg-slate-950 overflow-hidden">
              <ScrollArea className="max-h-[55vh]">
                {active.receipt_mime === "application/pdf" ? (
                  <iframe title="comprobante" src={active.receipt_url} className="w-full h-[55vh] bg-white" />
                ) : (
                  <img src={active.receipt_url} alt="comprobante" className="w-full h-auto" />
                )}
              </ScrollArea>
            </div>
          )}

          {action && action !== "preview" && (
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
                Nota para el cliente (opcional)
              </label>
              <Textarea
                data-testid="review-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  action === "rejected" ? "Ej: El comprobante no muestra el monto correcto…"
                  : action === "accepted" ? "Ej: ¡Gracias! Pago aplicado."
                  : "Ej: Estamos verificando con el banco."
                }
              />
              {action === "rejected" && (
                <label className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/5 p-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rollback}
                    onChange={(e) => setRollback(e.target.checked)}
                    className="mt-0.5"
                    data-testid="review-rollback"
                  />
                  <div>
                    <div className="flex items-center gap-1 font-semibold text-red-300"><AlertTriangle className="w-3 h-3" /> Revertir la extensión de servicio</div>
                    <div className="text-red-100/70">Al subir el comprobante se le extendió automáticamente 1 ciclo de pago. Marca esto para retroceder la fecha de vencimiento (y suspender si queda vencido).</div>
                  </div>
                </label>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeReview}>Cerrar</Button>
            {action && action !== "preview" && (
              <Button
                onClick={submitReview}
                data-testid="review-submit"
                className={
                  action === "accepted" ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                  : action === "rejected" ? "bg-red-500 hover:bg-red-600 text-white"
                  : ""
                }
              >
                {action === "accepted" ? "Confirmar Aceptar" : action === "rejected" ? "Confirmar Rechazar" : "Marcar pendiente"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
