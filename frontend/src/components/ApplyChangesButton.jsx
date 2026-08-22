import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCheck, Loader2, CheckCircle2, XCircle, Undo2, ListChecks, FilePlus2, FilePen, FileX2 } from "lucide-react";
import { toast } from "sonner";

const OP_STYLE = {
  Alta:    { cls: "border-emerald-500/40 text-emerald-500", Icon: FilePlus2 },
  Edición: { cls: "border-sky-500/40 text-sky-400",         Icon: FilePen },
  Baja:    { cls: "border-red-500/40 text-red-500",         Icon: FileX2 },
};

/**
 * Botón global "Aplicar Cambios": nada de lo que se captura en el CRM cuenta
 * como definitivo hasta que se confirma aquí. Mientras tanto los registros
 * viven marcados como pendientes y no salen hacia el Mikrotik.
 *
 * Al confirmar se recarga la página: los datos ya son otros en todas las
 * pantallas abiertas y es más honesto refrescarlas que dejarlas desfasadas.
 */
export default function ApplyChangesButton() {
  const { user } = useAuth();
  const [pending, setPending] = useState({ total: 0, items: [], by_module: {} });
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const canApply = ["owner", "admin"].includes(user?.role);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/pending-changes");
      setPending(data);
    } catch {
      /* si falla, el contador simplemente no se actualiza */
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [user, refresh]);

  if (!user) return null;

  // El clic en "Aplicar Cambios" ya es la confirmación: se guarda de una vez,
  // sin preguntar de nuevo. El diálogo solo aparece si algo falló, porque un
  // error que nadie ve es un error que nadie arregla.
  const apply = async () => {
    if (pending.total === 0) {
      toast.info("No hay cambios capturados por confirmar");
      return;
    }
    setRunning(true);
    try {
      const { data } = await api.post("/pending-changes/apply");
      if (data.failed > 0) {
        setResult(data);
        setOpen(true);
        toast.error(`Guardado con ${data.failed} error(es) — revisa el detalle`);
        await refresh();
      } else {
        toast.success(`${data.applied} cambio(s) guardados en el proyecto`);
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setRunning(false);
    }
  };

  const discardAll = async () => {
    if (!window.confirm(
      `Se descartarán los ${pending.total} cambio(s) sin confirmar.\n\n` +
      "Lo capturado se pierde: las altas se borran, las ediciones vuelven a como estaban " +
      "y las bajas se cancelan. ¿Continuar?"
    )) return;
    setRunning(true);
    try {
      const { data } = await api.post("/pending-changes/discard", {});
      toast.success(`${data.discarded} cambio(s) descartados`);
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast.error(formatApiError(e));
      setRunning(false);
    }
  };

  const discardOne = async (it) => {
    if (!window.confirm(`¿Descartar "${it.title}" (${it.op_label.toLowerCase()})?`)) return;
    try {
      await api.post("/pending-changes/discard", { collection: it.collection, id: it.id });
      toast.success("Descartado");
      await refresh();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const none = pending.total === 0;

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={none ? "outline" : "default"}
          onClick={apply}
          disabled={running || !canApply}
          title={none
            ? "No hay cambios sin confirmar"
            : `Guardar en el proyecto ${pending.total} cambio(s) capturados`}
          data-testid="apply-changes-btn"
        >
          {running
            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            : <CheckCheck className="w-3.5 h-3.5 mr-1.5" />}
          Aplicar Cambios
          {!none && (
            <span className="ml-1.5 rounded-full bg-background/25 px-1.5 text-[10px] font-mono">
              {pending.total}
            </span>
          )}
        </Button>

        {/* Revisar/descartar lo capturado sin estorbar el camino de confirmar. */}
        {!none && (
          <Button
            size="icon" variant="ghost"
            onClick={() => { setResult(null); refresh(); setOpen(true); }}
            title="Ver o descartar los cambios sin confirmar"
            data-testid="pending-review-btn"
          >
            <ListChecks className="w-4 h-4 text-muted-foreground" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {result
                ? <><CheckCheck className="w-4 h-4 text-primary" /> Resultado</>
                : <><ListChecks className="w-4 h-4 text-primary" /> Cambios sin confirmar</>}
            </DialogTitle>
            <DialogDescription>
              {result
                ? "Los datos ya son del proyecto. Lo que aparece abajo se guardó, pero no se pudo aplicar en el router."
                : 'Nada de esto cuenta todavía en el proyecto. Presiona "Aplicar Cambios" para guardarlo, o descarta lo que no quieras.'}
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> {result.applied} guardados
                </Badge>
                {result.failed > 0 && (
                  <Badge variant="outline" className="border-red-500/40 text-red-500">
                    <XCircle className="w-3 h-3 mr-1" /> {result.failed} con problema
                  </Badge>
                )}
              </div>
              {result.details?.failed?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-red-500 mb-1">
                    Se guardaron, pero no se pudieron aplicar en el router:
                  </div>
                  <ul className="text-xs space-y-1 max-h-56 overflow-y-auto">
                    {result.details.failed.map((f, i) => (
                      <li key={i} className="rounded border border-red-500/20 bg-red-500/5 p-1.5">
                        <b>{f.title}</b> · {f.module} · {f.op_label} — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : none ? (
            <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              No hay nada capturado sin confirmar. Todo lo que ves en el CRM ya es definitivo.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(pending.by_module).map(([m, n]) => (
                  <Badge key={m} variant="outline" className="text-[10px]">{m}: {n}</Badge>
                ))}
              </div>
              <div className="rounded-md border border-border divide-y divide-border max-h-[45vh] overflow-y-auto">
                {pending.items.map((it) => {
                  const style = OP_STYLE[it.op_label] || OP_STYLE.Edición;
                  const { Icon } = style;
                  return (
                    <div key={`${it.collection}-${it.id}`}
                      className="flex items-center justify-between gap-3 p-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${style.cls}`}>
                          <Icon className="w-2.5 h-2.5 mr-1" /> {it.op_label}
                        </Badge>
                        <div className="min-w-0">
                          <div className="text-sm truncate">{it.title}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {it.module}
                            {it.changed_fields?.length > 0 && ` · ${it.changed_fields.length} campo(s)`}
                            {it.by_name && ` · ${it.by_name}`}
                          </div>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => discardOne(it)}
                        title="Descartar este cambio" data-testid={`pending-discard-${it.id}`}>
                        <Undo2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
            {!result && !none && canApply && (
              <Button variant="outline" onClick={discardAll} disabled={running}
                data-testid="pending-discard-all">
                <Undo2 className="w-3.5 h-3.5 mr-1" /> Descartar todo
              </Button>
            )}
            {!result && !none && !canApply && (
              <span className="text-xs text-muted-foreground self-center">
                Solo un administrador puede confirmar.
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
