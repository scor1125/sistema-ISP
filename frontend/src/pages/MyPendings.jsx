import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Pin, PinOff, Trash2, Check, Circle, StickyNote } from "lucide-react";
import { toast } from "sonner";

/**
 * Personal pending notes — each technician has their own private sticky-note
 * board. Nothing here is shared with other users unless they choose to file
 * a real task in the Tareas/Embudos module.
 */
const COLORS = [
  { key: "default", cls: "border-border bg-card", label: "Neutro" },
  { key: "amber",   cls: "border-amber-500/30 bg-amber-500/10", label: "Ámbar" },
  { key: "sky",     cls: "border-sky-500/30 bg-sky-500/10", label: "Cielo" },
  { key: "emerald", cls: "border-emerald-500/30 bg-emerald-500/10", label: "Esmeralda" },
  { key: "rose",    cls: "border-rose-500/30 bg-rose-500/10", label: "Rosa" },
  { key: "violet",  cls: "border-violet-500/30 bg-violet-500/10", label: "Violeta" },
];

const colorCls = (key) => COLORS.find((c) => c.key === key)?.cls || COLORS[0].cls;

export default function MyPendings() {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [color, setColor] = useState("default");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/my-notes");
      setNotes(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e?.preventDefault();
    if (!title.trim()) { toast.error("Escribe un título"); return; }
    setLoading(true);
    try {
      await api.post("/my-notes", { title: title.trim(), body: body.trim(), color });
      setTitle(""); setBody(""); setColor("default");
      await load();
      toast.success("Pendiente agregado");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  const patch = async (id, updates) => {
    setNotes((s) => s.map((n) => (n.id === id ? { ...n, ...updates } : n)));
    try { await api.patch(`/my-notes/${id}`, updates); }
    catch (e) { toast.error(formatApiError(e)); load(); }
  };

  const del = async (id) => {
    if (!window.confirm("¿Eliminar pendiente?")) return;
    try { await api.delete(`/my-notes/${id}`); load(); toast.success("Eliminado"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const { pinned, active, done } = useMemo(() => {
    const p = notes.filter((n) => n.pinned && !n.done);
    const a = notes.filter((n) => !n.pinned && !n.done);
    const d = notes.filter((n) => n.done);
    return { pinned: p, active: a, done: d };
  }, [notes]);

  return (
    <div>
      <PageHeader
        title="Mis pendientes"
        subtitle="Tu tablero personal de notas y recordatorios. Nadie más ve esto."
      />

      {/* Quick add card */}
      <form onSubmit={add} className="rounded-md border border-border bg-card p-4 mb-6" data-testid="add-note-form">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="¿Qué tienes pendiente? (Ej: Revisar ONU cliente Pérez)"
          className="mb-2"
          data-testid="note-title"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Detalles del pendiente (opcional)…"
          rows={2}
          data-testid="note-body"
        />
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                onClick={() => setColor(c.key)}
                data-testid={`color-${c.key}`}
                className={`w-6 h-6 rounded-full border-2 ${c.cls} ${color === c.key ? "ring-2 ring-offset-2 ring-offset-background ring-foreground" : ""}`}
              />
            ))}
          </div>
          <Button type="submit" disabled={loading} className="ml-auto" data-testid="add-note-btn">
            <StickyNote className="w-4 h-4 mr-1" /> {loading ? "Guardando…" : "Agregar pendiente"}
          </Button>
        </div>
      </form>

      {pinned.length > 0 && (
        <Section title="Fijados" count={pinned.length}>
          {pinned.map((n) => <NoteCard key={n.id} note={n} onPatch={patch} onDelete={del} />)}
        </Section>
      )}

      <Section title="Activos" count={active.length} empty={!pinned.length && !active.length && !done.length ? "Aún no tienes pendientes. Agrega uno con el formulario de arriba." : null}>
        {active.map((n) => <NoteCard key={n.id} note={n} onPatch={patch} onDelete={del} />)}
      </Section>

      {done.length > 0 && (
        <Section title="Completados" count={done.length}>
          {done.map((n) => <NoteCard key={n.id} note={n} onPatch={patch} onDelete={del} muted />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, empty, children }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">{title}</div>
        <Badge variant="outline" className="text-[10px] font-mono">{count ?? 0}</Badge>
      </div>
      {empty ? (
        <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {children}
        </div>
      )}
    </section>
  );
}

function NoteCard({ note, onPatch, onDelete, muted }) {
  const created = note.created_at ? new Date(note.created_at) : null;
  return (
    <div className={`rounded-md border p-3 ${colorCls(note.color)} ${muted ? "opacity-70" : ""}`} data-testid={`note-${note.id}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onPatch(note.id, { done: !note.done })}
          title={note.done ? "Marcar como pendiente" : "Marcar como completado"}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          data-testid={`toggle-done-${note.id}`}
        >
          {note.done ? <Check className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4" />}
        </button>
        <div className={`flex-1 min-w-0 ${note.done ? "line-through" : ""}`}>
          <div className="font-medium text-sm break-words">{note.title}</div>
          {note.body && <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{note.body}</div>}
        </div>
        <button
          type="button"
          onClick={() => onPatch(note.id, { pinned: !note.pinned })}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title={note.pinned ? "Desfijar" : "Fijar arriba"}
          data-testid={`pin-${note.id}`}
        >
          {note.pinned ? <Pin className="w-4 h-4 text-primary" /> : <PinOff className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => onDelete(note.id)}
          className="text-muted-foreground hover:text-destructive shrink-0"
          title="Eliminar"
          data-testid={`del-${note.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {created && (
        <div className="mt-2 text-[10px] text-muted-foreground font-mono">
          {created.toLocaleDateString()} · {created.toLocaleTimeString().slice(0, 5)}
        </div>
      )}
    </div>
  );
}
