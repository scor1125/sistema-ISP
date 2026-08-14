import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, Kpi, EmptyRow, SearchBar, norm } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Package, Plus, Pencil, Trash2, ShoppingCart, AlertTriangle, PackageX,
  History, Users as UsersIcon, Boxes, DollarSign, Receipt, X,
} from "lucide-react";
import { toast } from "sonner";

const MXN = (n) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const isLow = (p) => Number(p?.stock || 0) <= Number(p?.min_stock || 5);

/* ============================================================
   TAB · PRODUCTOS
   ============================================================ */
function ProductDialog({ open, onOpenChange, initial, onSaved }) {
  const isEdit = !!initial;
  const [f, setF] = useState({ name: "", sku: "", price: "", stock: "", min_stock: "5", notes: "" });
  useEffect(() => {
    if (open) {
      setF({
        name: initial?.name || "",
        sku: initial?.sku || "",
        price: initial?.price?.toString() || "",
        stock: initial?.stock?.toString() || "",
        min_stock: (initial?.min_stock ?? 5).toString(),
        notes: initial?.notes || "",
      });
    }
  }, [open, initial]);

  const submit = async () => {
    if (!f.name.trim()) return toast.error("El nombre es obligatorio");
    const price = Number(f.price);
    const stock = Number(f.stock);
    const min_stock = Number(f.min_stock);
    if (Number.isNaN(price) || price < 0) return toast.error("Precio inválido");
    if (Number.isNaN(stock) || stock < 0) return toast.error("Stock inválido");
    if (Number.isNaN(min_stock) || min_stock < 0) return toast.error("Stock mínimo inválido");
    try {
      const payload = {
        name: f.name.trim(),
        sku: f.sku.trim(),
        price,
        stock,
        min_stock,
        notes: f.notes.trim(),
      };
      if (isEdit) {
        await api.patch(`/inventory/products/${initial.id}`, payload);
        toast.success("Producto actualizado");
      } else {
        await api.post("/inventory/products", payload);
        toast.success("Producto agregado");
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
            <Package className="w-4 h-4 text-primary" />
            {isEdit ? "Editar producto" : "Agregar producto"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nombre</Label>
            <Input data-testid="inv-prod-name" value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ej: Router TP-Link Archer C6" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">SKU (opcional)</Label>
              <Input data-testid="inv-prod-sku" value={f.sku}
                onChange={(e) => setF({ ...f, sku: e.target.value })}
                placeholder="TP-C6-001" />
            </div>
            <div>
              <Label className="text-xs">Precio de venta</Label>
              <Input data-testid="inv-prod-price" type="number" step="0.01" min="0"
                value={f.price}
                onChange={(e) => setF({ ...f, price: e.target.value })}
                placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Stock actual</Label>
              <Input data-testid="inv-prod-stock" type="number" min="0"
                value={f.stock}
                onChange={(e) => setF({ ...f, stock: e.target.value })}
                placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Stock mínimo (alerta)</Label>
              <Input data-testid="inv-prod-min" type="number" min="0"
                value={f.min_stock}
                onChange={(e) => setF({ ...f, min_stock: e.target.value })}
                placeholder="5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea data-testid="inv-prod-notes" value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Detalles, proveedor, garantía…" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} data-testid="inv-prod-save">{isEdit ? "Guardar cambios" : "Agregar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductsTab({ products, reload }) {
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [askDelete, setAskDelete] = useState(null);

  const filtered = useMemo(() => {
    const nq = norm(q);
    return products.filter((p) => {
      if (onlyLow && !isLow(p)) return false;
      if (!nq) return true;
      return norm(`${p.name} ${p.sku || ""} ${p.notes || ""}`).includes(nq);
    });
  }, [products, q, onlyLow]);

  const doDelete = async () => {
    if (!askDelete) return;
    try {
      await api.delete(`/inventory/products/${askDelete.id}`);
      toast.success(`"${askDelete.name}" eliminado`);
      setAskDelete(null);
      reload();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <SearchBar value={q} onChange={setQ}
            placeholder="Buscar por nombre, SKU o notas…"
            hint={`${filtered.length} / ${products.length}`}
            testId="inv-prod-search" />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <Switch checked={onlyLow} onCheckedChange={setOnlyLow} data-testid="inv-prod-only-low" />
          <AlertTriangle className={`w-3.5 h-3.5 ${onlyLow ? "text-amber-500" : "text-muted-foreground"}`} />
          Solo stock bajo (≤ min)
        </label>
        <Button onClick={() => { setEditing(null); setDlgOpen(true); }} data-testid="inv-prod-add">
          <Plus className="w-4 h-4 mr-1" /> Agregar producto
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <EmptyRow colSpan={6} text={products.length === 0
                ? "Aún no hay productos. Haz clic en 'Agregar producto'."
                : "Nada coincide con la búsqueda."} />
            )}
            {filtered.map((p) => {
              const low = isLow(p);
              const out = Number(p.stock || 0) === 0;
              return (
                <TableRow key={p.id} data-testid={`inv-prod-row-${p.id}`}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-primary" />
                      {p.name}
                      {out && (
                        <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-500">
                          <PackageX className="w-3 h-3 mr-1" /> Agotado
                        </Badge>
                      )}
                      {!out && low && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Stock bajo
                        </Badge>
                      )}
                    </div>
                    {p.notes && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{p.notes}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.sku || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-mono">{MXN(p.price)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={out ? "text-red-500" : low ? "text-amber-500" : ""}>{p.stock ?? 0}</span>
                    <span className="text-[10px] text-muted-foreground ml-1">/ min {p.min_stock ?? 5}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{MXN((p.stock || 0) * (p.price || 0))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost"
                      onClick={() => { setEditing(p); setDlgOpen(true); }}
                      data-testid={`inv-prod-edit-${p.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost"
                      onClick={() => setAskDelete(p)}
                      data-testid={`inv-prod-del-${p.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ProductDialog
        open={dlgOpen}
        onOpenChange={setDlgOpen}
        initial={editing}
        onSaved={reload}
      />

      <AlertDialog open={!!askDelete} onOpenChange={(o) => { if (!o) setAskDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              Eliminar "{askDelete?.name}"
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto se eliminará del inventario,
              pero las ventas históricas conservarán su registro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="inv-prod-del-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} data-testid="inv-prod-del-confirm"
              className="bg-destructive hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============================================================
   TAB · NUEVA VENTA
   ============================================================ */
function NewSaleTab({ products, customers, reload, onDone }) {
  const [clientId, setClientId] = useState("__walkin__");
  const [walkinName, setWalkinName] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]);   // [{product_id, quantity}]
  const [saving, setSaving] = useState(false);

  const addLine = () => setLines((prev) => [...prev, { product_id: "", quantity: 1 }]);
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const setLine = (idx, patch) => setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const enriched = useMemo(() => lines.map((ln) => {
    const p = productsById[ln.product_id];
    const price = Number(p?.price || 0);
    const qty = Number(ln.quantity || 0);
    return { ...ln, product: p, unit_price: price, subtotal: +(price * qty).toFixed(2), stock: Number(p?.stock || 0) };
  }), [lines, productsById]);

  const total = useMemo(() => enriched.reduce((s, e) => s + e.subtotal, 0), [enriched]);
  const hasErrors = enriched.some((e) => !e.product_id || e.quantity <= 0 || e.quantity > e.stock);

  const submit = async () => {
    if (lines.length === 0) return toast.error("Agrega al menos un producto");
    if (hasErrors) return toast.error("Revisa cantidades / stock disponible");
    setSaving(true);
    try {
      const payload = {
        client_id: clientId && clientId !== "__walkin__" ? clientId : null,
        client_name_override: clientId === "__walkin__" ? walkinName : "",
        items: lines.map((ln) => ({ product_id: ln.product_id, quantity: Number(ln.quantity) })),
        payment_method: payMethod,
        notes,
      };
      const { data } = await api.post("/inventory/sales", payload);
      toast.success(`Venta registrada · ${MXN(data.total)} · ${data.client_name}`);
      setLines([]); setNotes(""); setWalkinName(""); setClientId("__walkin__");
      reload();
      onDone?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const availableProducts = products.filter((p) => Number(p.stock || 0) > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Left: sale builder */}
      <div className="lg:col-span-3 space-y-4">
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-primary" />
            <div className="font-semibold text-sm">Cliente</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Seleccionar cliente registrado</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger data-testid="inv-sale-client">
                  <SelectValue placeholder="Elige cliente…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__walkin__">— Cliente ocasional (no registrado)</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}{c.phone ? ` · ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {clientId === "__walkin__" && (
              <div>
                <Label className="text-xs">Nombre (opcional)</Label>
                <Input value={walkinName} onChange={(e) => setWalkinName(e.target.value)}
                  placeholder="Cliente ocasional" data-testid="inv-sale-walkin" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            <div className="font-semibold text-sm">Productos</div>
            <Button size="sm" variant="outline" onClick={addLine}
              className="ml-auto" data-testid="inv-sale-add-line"
              disabled={availableProducts.length === 0}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Agregar línea
            </Button>
          </div>

          {availableProducts.length === 0 && (
            <div className="text-sm text-muted-foreground italic p-3 bg-muted/30 rounded">
              No hay productos con stock. Ve a la pestaña "Productos" para dar de alta.
            </div>
          )}

          {lines.length === 0 && availableProducts.length > 0 && (
            <div className="text-sm text-muted-foreground italic p-3 bg-muted/30 rounded">
              Haz clic en "Agregar línea" para añadir un producto a esta venta.
            </div>
          )}

          {lines.map((ln, idx) => {
            const e = enriched[idx];
            const overflow = e.quantity > e.stock;
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded border border-border/60">
                <div className="col-span-12 md:col-span-6">
                  <Label className="text-[11px]">Producto</Label>
                  <Select value={ln.product_id} onValueChange={(v) => setLine(idx, { product_id: v })}>
                    <SelectTrigger data-testid={`inv-sale-prod-${idx}`}>
                      <SelectValue placeholder="Elige un producto…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · {MXN(p.price)} · stock {p.stock}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-[11px]">Cantidad</Label>
                  <Input type="number" min="1" max={e.stock || 1}
                    value={ln.quantity}
                    onChange={(ev) => setLine(idx, { quantity: Number(ev.target.value) })}
                    data-testid={`inv-sale-qty-${idx}`}
                    className={overflow ? "border-red-500" : ""} />
                </div>
                <div className="col-span-4 md:col-span-2 text-right">
                  <div className="text-[11px] text-muted-foreground">Unit.</div>
                  <div className="font-mono text-sm">{MXN(e.unit_price)}</div>
                </div>
                <div className="col-span-3 md:col-span-1 text-right">
                  <div className="text-[11px] text-muted-foreground">Subtotal</div>
                  <div className="font-mono text-sm font-semibold">{MXN(e.subtotal)}</div>
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button size="icon" variant="ghost" onClick={() => removeLine(idx)}
                    data-testid={`inv-sale-remove-${idx}`}>
                    <X className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                {overflow && (
                  <div className="col-span-12 text-[11px] text-red-500 font-mono">
                    ⚠ Stock disponible: {e.stock}. Ajusta la cantidad.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Método de pago</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger data-testid="inv-sale-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Efectivo</SelectItem>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                  <SelectItem value="card">Tarjeta</SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones opcionales…" data-testid="inv-sale-notes" />
            </div>
          </div>
        </div>
      </div>

      {/* Right: totals sticky panel */}
      <div className="lg:col-span-2">
        <div className="rounded-md border border-border bg-card p-4 lg:sticky lg:top-4 space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            <div className="font-semibold">Resumen de la venta</div>
          </div>
          <div className="border-t border-border/60 pt-3 space-y-1 text-sm">
            {enriched.length === 0 && (
              <div className="text-muted-foreground italic">Sin productos aún.</div>
            )}
            {enriched.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {e.product?.name || <span className="text-muted-foreground">(sin seleccionar)</span>}
                  {e.quantity > 0 && <span className="text-muted-foreground"> × {e.quantity}</span>}
                </span>
                <span className="font-mono">{MXN(e.subtotal)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 pt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-heading text-2xl text-primary" data-testid="inv-sale-total">{MXN(total)}</span>
          </div>
          <Button
            className="w-full" size="lg"
            onClick={submit}
            disabled={saving || lines.length === 0 || hasErrors}
            data-testid="inv-sale-submit"
          >
            <DollarSign className="w-4 h-4 mr-1" />
            {saving ? "Registrando…" : "Registrar venta"}
          </Button>
          <div className="text-[11px] text-muted-foreground text-center">
            Al registrar se descontará automáticamente del inventario.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TAB · HISTORIAL
   ============================================================ */
function SalesHistoryTab({ sales, customers }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState({});
  const customersById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return sales;
    return sales.filter((s) => norm(`${s.client_name} ${s.notes || ""} ${s.payment_method || ""} ${(s.items || []).map((i) => i.product_name).join(" ")}`).includes(nq));
  }, [sales, q]);

  return (
    <div className="space-y-3">
      <SearchBar value={q} onChange={setQ}
        placeholder="Buscar en historial (cliente, producto, notas)…"
        hint={`${filtered.length} / ${sales.length}`}
        testId="inv-sales-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Vendedor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <EmptyRow colSpan={6} text={sales.length === 0
                ? "Aún no hay ventas registradas."
                : "Nada coincide con la búsqueda."} />
            )}
            {filtered.map((s) => {
              const client = s.client_id ? customersById[s.client_id] : null;
              const isOpen = !!expanded[s.id];
              return (
                <>
                  <TableRow key={s.id} data-testid={`inv-sale-row-${s.id}`}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                    <TableCell className="text-xs font-mono">{dt(s.created_at)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{s.client_name}</div>
                      {client?.phone && <div className="text-[11px] text-muted-foreground">{client.phone}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {(s.items || []).reduce((a, b) => a + b.quantity, 0)} u · {(s.items || []).length} sku
                      </Badge>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{s.payment_method}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-semibold">{MXN(s.total)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.created_by_name || "—"}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${s.id}-detail`} className="bg-muted/20">
                      <TableCell colSpan={6}>
                        <div className="p-2 space-y-1">
                          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Detalle</div>
                          <div className="space-y-1">
                            {(s.items || []).map((it, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 text-sm py-1 border-b border-border/40 last:border-0">
                                <div>
                                  <span className="font-medium">{it.product_name}</span>
                                  {it.sku && <span className="text-[11px] text-muted-foreground font-mono ml-1">· {it.sku}</span>}
                                </div>
                                <div className="font-mono text-xs">
                                  {it.quantity} × {MXN(it.unit_price)} = <span className="font-semibold">{MXN(it.subtotal)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {s.notes && <div className="text-xs text-muted-foreground italic mt-1">"{s.notes}"</div>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ============================================================
   TAB · CLIENTES (lightweight view + purchase history)
   ============================================================ */
function CustomersTab({ customers, sales }) {
  const [q, setQ] = useState("");
  const purchasesByClient = useMemo(() => {
    const map = new Map();
    for (const s of sales) {
      if (!s.client_id) continue;
      const cur = map.get(s.client_id) || { count: 0, total: 0, last: null };
      cur.count += 1;
      cur.total += Number(s.total || 0);
      if (!cur.last || new Date(s.created_at) > new Date(cur.last)) cur.last = s.created_at;
      map.set(s.client_id, cur);
    }
    return map;
  }, [sales]);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return customers;
    return customers.filter((c) => norm(`${c.full_name} ${c.phone || ""} ${c.email || ""}`).includes(nq));
  }, [customers, q]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-start gap-2">
          <UsersIcon className="w-4 h-4 text-primary mt-0.5" />
          <div>
            La lista de clientes se comparte con el módulo <a href="/clientes" className="underline text-primary">Clientes</a>.
            Aquí ves un resumen rápido con historial de compras del inventario. Para agregar, editar o eliminar clientes, usa el módulo principal.
          </div>
        </div>
      </div>

      <SearchBar value={q} onChange={setQ}
        placeholder="Buscar cliente por nombre, teléfono o email…"
        hint={`${filtered.length} / ${customers.length}`}
        testId="inv-cust-search" />

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Compras</TableHead>
              <TableHead className="text-right">Total gastado</TableHead>
              <TableHead>Última compra</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <EmptyRow colSpan={6} text="Sin clientes." />}
            {filtered.map((c) => {
              const p = purchasesByClient.get(c.id) || { count: 0, total: 0, last: null };
              return (
                <TableRow key={c.id} data-testid={`inv-cust-row-${c.id}`}>
                  <TableCell className="font-medium">{c.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.phone || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{c.email || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-mono">{p.count}</TableCell>
                  <TableCell className="text-right font-mono">{p.total > 0 ? MXN(p.total) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.last ? dt(p.last) : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE ROOT
   ============================================================ */
export default function Inventario() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState("productos");

  const reload = useCallback(async () => {
    try {
      const [pr, sa, cu, st] = await Promise.all([
        api.get("/inventory/products"),
        api.get("/inventory/sales"),
        api.get("/inventory/customers"),
        api.get("/inventory/stats"),
      ]);
      setProducts(pr.data);
      setSales(sa.data);
      setCustomers(cu.data);
      setStats(st.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle="Gestiona productos, ventas y clientes en un solo lugar. Al registrar una venta, el stock se ajusta automáticamente."
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 sm:gap-3 mb-4">
        <Kpi label="Productos" value={stats?.total_products ?? 0} testId="inv-kpi-products" />
        <Kpi label="Unidades" value={stats?.total_units ?? 0} testId="inv-kpi-units" />
        <Kpi label="Valor inventario" value={stats ? MXN(stats.total_value) : "—"} tone="info" testId="inv-kpi-value" />
        <Kpi label="Stock bajo" value={stats?.low_stock ?? 0} tone={stats?.low_stock > 0 ? "warn" : "default"} testId="inv-kpi-low" />
        <Kpi label="Ventas totales" value={stats?.total_sales ?? 0} testId="inv-kpi-sales" />
        <Kpi label="Ingresos" value={stats ? MXN(stats.total_revenue) : "—"} tone="success" testId="inv-kpi-revenue" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="productos" data-testid="inv-tab-productos">
            <Boxes className="w-3.5 h-3.5 mr-1" /> Productos
          </TabsTrigger>
          <TabsTrigger value="nueva-venta" data-testid="inv-tab-sale">
            <ShoppingCart className="w-3.5 h-3.5 mr-1" /> Nueva venta
          </TabsTrigger>
          <TabsTrigger value="historial" data-testid="inv-tab-history">
            <History className="w-3.5 h-3.5 mr-1" /> Historial
          </TabsTrigger>
          <TabsTrigger value="clientes" data-testid="inv-tab-customers">
            <UsersIcon className="w-3.5 h-3.5 mr-1" /> Clientes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="productos">
          <ProductsTab products={products} reload={reload} />
        </TabsContent>
        <TabsContent value="nueva-venta">
          <NewSaleTab
            products={products}
            customers={customers}
            reload={reload}
            onDone={() => setTab("historial")}
          />
        </TabsContent>
        <TabsContent value="historial">
          <SalesHistoryTab sales={sales} customers={customers} />
        </TabsContent>
        <TabsContent value="clientes">
          <CustomersTab customers={customers} sales={sales} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
