import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CloudUpload, Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Botón global "Aplicar Cambios": recorre todos los clientes y sincroniza su
 * cola/PPPoE contra el Mikrotik según sus datos actuales. Es la misma
 * sincronización que ya corre sola al guardar un cliente — sirve de red de
 * seguridad para cuando algo no se aplicó en su momento (ej. un cliente
 * quedó sin plan y por eso nunca sincronizó).
 */
export default function ApplyChangesButton() {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);

  // Solo owner/admin — el endpoint exige el mismo nivel para no dejar que
  // cualquier rol dispare cambios de configuración en los routers.
  if (!["owner", "admin"].includes(user?.role)) return null;

  const run = async () => {
    setRunning(true);
    try {
      const { data } = await api.post("/clients/apply-changes");
      setResult(data);
      setOpen(true);
      if (data.failed > 0) {
        toast.error(`Aplicado con ${data.failed} error(es) — revisa el detalle`);
      } else {
        toast.success(`Cambios aplicados: ${data.synced} sincronizados`);
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={run}
        disabled={running}
        title="Sincroniza todos los clientes con el Mikrotik ahora mismo"
        data-testid="apply-changes-btn"
      >
        {running ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <CloudUpload className="w-3.5 h-3.5 mr-1.5" />
        )}
        Aplicar Cambios
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-primary" />
              Cambios aplicados
            </DialogTitle>
            <DialogDescription>
              Se revisaron {result?.total ?? 0} clientes y se sincronizó su cola o PPPoE
              contra el Mikrotik según sus datos actuales.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> {result.synced} sincronizados
                </Badge>
                <Badge variant="outline" className="border-red-500/40 text-red-500">
                  <XCircle className="w-3 h-3 mr-1" /> {result.failed} con error
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  <MinusCircle className="w-3 h-3 mr-1" /> {result.skipped} sin datos suficientes
                </Badge>
              </div>

              {result.details?.failed?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-red-500 mb-1">Con error:</div>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                    {result.details.failed.map((f, i) => (
                      <li key={i} className="rounded border border-red-500/20 bg-red-500/5 p-1.5">
                        <b>{f.name}</b> ({f.mode}) — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.details?.skipped?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Sin datos suficientes:</div>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                    {result.details.skipped.map((s, i) => (
                      <li key={i} className="rounded border border-border/60 p-1.5 text-muted-foreground">
                        <b>{s.name}</b> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
