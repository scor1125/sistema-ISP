import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Eye } from "lucide-react";
import { toast } from "sonner";

const STAGES = [
  { key: "backlog", label: "Por hacer" },
  { key: "today", label: "Hoy" },
  { key: "in_progress", label: "En proceso" },
  { key: "done", label: "Completado" },
];

const INITIAL_TASK = { stage: "backlog" };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [t, u, c] = await Promise.all([api.get("/tasks"), api.get("/users"), api.get("/clients")]);
    setTasks(t.data); setUsers(u.data); setClients(c.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => [
    { name: "title", label: "Título", required: true, full: true },
    { name: "description", label: "Descripción", type: "textarea", full: true },
    { name: "stage", label: "Etapa", type: "select", options: STAGES.map(s => ({ value: s.key, label: s.label })) },
    { name: "assigned_to", label: "Asignada a", type: "select", options: users.map(u => ({ value: u.id, label: u.name })) },
    { name: "client_id", label: "Cliente relacionado", type: "select", options: clients.map(c => ({ value: c.id, label: c.full_name })) },
    { name: "due_date", label: "Fecha límite (YYYY-MM-DD)" },
  ], [users, clients]);

  const tasksByStage = useMemo(() => {
    const acc = { backlog: [], today: [], in_progress: [], done: [] };
    const nq = norm(q);
    tasks.forEach((t) => {
      if (!acc[t.stage]) return;
      if (nq) {
        const u = users.find(x => x.id === t.assigned_to);
        const c = clients.find(x => x.id === t.client_id);
        const hay = norm(`${t.title} ${t.description} ${u?.name||""} ${c?.full_name||""} ${t.due_date||""}`);
        if (!hay.includes(nq)) return;
      }
      acc[t.stage].push(t);
    });
    return acc;
  }, [tasks, users, clients, q]);

  const save = async (v) => {
    try {
      if (editing) {
        await api.patch(`/tasks/${editing.id}`, v);
        toast.success("Tarea actualizada");
      } else {
        await api.post("/tasks", v);
        toast.success("Tarea creada");
      }
      setEditing(null);
      await load();
    } catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const move = async (t, stage) => {
    await api.patch(`/tasks/${t.id}`, { stage });
    await load();
  };
  const del = async (id) => {
    if (!window.confirm("¿Eliminar?")) return;
    try { await api.delete(`/tasks/${id}`); toast.success("Eliminada"); await load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const openEdit = (t) => { setEditing(t); setOpen(true); };
  const openNew = () => { setEditing(null); setOpen(true); };

  return (
    <div>
      <PageHeader title="Tareas / Embudos"
        subtitle="Kanban simple para tareas diarias y comentarios de operación. Click en una tarea para ver detalles."
        actions={<Button data-testid="new-task-btn" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Nueva tarea</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar por título, descripción, técnico o cliente…" testId="tasks-search" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {STAGES.map((s) => {
          const list = tasksByStage[s.key] || [];
          return (
            <div key={s.key} className="rounded-md border border-border bg-card min-h-[300px] flex flex-col">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-medium">{s.label}</div>
                <Badge variant="outline" className="font-mono text-xs">{list.length}</Badge>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-auto">
                {list.map((t) => {
                  const u = users.find((x) => x.id === t.assigned_to);
                  const c = clients.find((x) => x.id === t.client_id);
                  return (
                    <div key={t.id} className="rounded-md border border-border p-3 bg-background hover:bg-accent transition-colors"
                      data-testid={`task-card-${t.id}`}>
                      <div className="cursor-pointer" onClick={() => setDetail({ ...t, assigned: u, client: c })}>
                        <div className="font-medium text-sm">{t.title}</div>
                        {t.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</div>}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {u && <Badge variant="outline" className="text-[10px]">{u.name}</Badge>}
                          {c && <Badge variant="outline" className="text-[10px]">{c.full_name}</Badge>}
                          {t.due_date && <Badge variant="outline" className="text-[10px] font-mono">{t.due_date}</Badge>}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        {STAGES.filter((x) => x.key !== t.stage).map((x) => (
                          <Button key={x.key} size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => move(t, x.key)}>{x.label}</Button>
                        ))}
                        <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={() => openEdit(t)} data-testid={`edit-task-${t.id}`}><Pencil className="w-3 h-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del(t.id)} data-testid={`del-task-${t.id}`}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Sin tareas.</div>}
              </div>
            </div>
          );
        })}
      </div>

      <FormDialog open={open} onOpenChange={(v)=>{ setOpen(v); if(!v) setEditing(null); }}
        title={editing ? `Editar · ${editing.title || "tarea"}` : "Nueva tarea"}
        fields={fields} initial={editing || INITIAL_TASK} onSubmit={save}
        submitLabel={editing ? "Guardar cambios" : "Crear"} />

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5 text-primary" /> Detalle de tarea</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-widest font-mono">Título</div>
                <div className="font-medium text-base">{detail.title}</div>
              </div>
              {detail.description && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest font-mono">Descripción</div>
                  <div className="whitespace-pre-wrap">{detail.description}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Etapa</div><div>{STAGES.find(s=>s.key===detail.stage)?.label}</div></div>
                <div><div className="text-xs text-muted-foreground">Fecha límite</div><div className="font-mono">{detail.due_date || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Asignada a</div><div>{detail.assigned?.name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Cliente</div><div>{detail.client?.full_name || "—"}</div></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDetail(null); openEdit(detail); }}><Pencil className="w-4 h-4 mr-1"/> Editar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
