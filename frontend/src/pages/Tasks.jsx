import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, SearchBar, norm } from "@/components/Common";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
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

  // Group tasks by stage once per tasks change (with search filter).
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
    try { await api.post("/tasks", v); toast.success("Tarea creada"); await load(); }
    catch (e) { toast.error(formatApiError(e)); throw e; }
  };

  const move = async (t, stage) => {
    await api.patch(`/tasks/${t.id}`, { stage });
    await load();
  };
  const del = async (id) => { if (window.confirm("¿Eliminar?")) { await api.delete(`/tasks/${id}`); load(); } };

  return (
    <div>
      <PageHeader title="Tareas / Embudos"
        subtitle="Kanban simple para tareas diarias y comentarios de operación."
        actions={<Button data-testid="new-task-btn" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />Nueva tarea</Button>} />
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
                    <div key={t.id} className="rounded-md border border-border p-3 bg-background hover:bg-accent transition-colors">
                      <div className="font-medium text-sm">{t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground mt-1">{t.description}</div>}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {u && <Badge variant="outline" className="text-[10px]">{u.name}</Badge>}
                        {c && <Badge variant="outline" className="text-[10px]">{c.full_name}</Badge>}
                        {t.due_date && <Badge variant="outline" className="text-[10px] font-mono">{t.due_date}</Badge>}
                      </div>
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        {STAGES.filter((x) => x.key !== t.stage).map((x) => (
                          <Button key={x.key} size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => move(t, x.key)}>{x.label}</Button>
                        ))}
                        <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={() => del(t.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <FormDialog open={open} onOpenChange={setOpen} title="Nueva tarea"
        fields={fields} initial={INITIAL_TASK} onSubmit={save} />
    </div>
  );
}
