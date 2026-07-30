import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBusinessConfig } from "@/context/BusinessConfigContext";
import { useAuth } from "@/context/AuthContext";
import { Upload, Trash2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const { refresh, setConfig } = useBusinessConfig();
  const { user } = useAuth();
  const canEdit = ["owner", "admin"].includes(user?.role);

  useEffect(() => { (async () => { setCfg((await api.get("/config")).data); })(); }, []);

  const set = (k, v) => setCfg((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...cfg };
      delete payload.id; delete payload.updated_at;
      await api.put("/config", payload);
      toast.success("Configuración guardada");
      await refresh();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El logo excede 2MB. Reduce el tamaño e inténtalo de nuevo.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const { data } = await api.post("/config/logo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      set("logo_url", data.logo_url);
      setConfig((prev) => ({ ...(prev || {}), logo_url: data.logo_url }));
      toast.success("Logo actualizado");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeLogo = async () => {
    if (!window.confirm("¿Quitar el logo personalizado?")) return;
    try {
      await api.delete("/config/logo");
      set("logo_url", "");
      setConfig((prev) => ({ ...(prev || {}), logo_url: "" }));
      toast.success("Logo eliminado");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!cfg) return null;

  return (
    <div>
      <PageHeader title="Configuración"
        subtitle="Información del negocio, logo personalizable y umbrales técnicos."
        actions={<Button onClick={save} disabled={saving} data-testid="save-config">{saving ? "Guardando…" : "Guardar cambios"}</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Logo card */}
        <section className="rounded-md border border-border bg-card p-5 space-y-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display font-semibold text-lg">Logo del negocio</h3>
            <div className="text-xs text-muted-foreground font-mono">
              PNG, JPEG, WEBP, GIF o SVG · máx. 2MB
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="w-24 h-24 rounded-md border border-border bg-background grid place-items-center overflow-hidden">
              {cfg.logo_url ? (
                <img src={cfg.logo_url} alt="Logo" className="w-full h-full object-contain" data-testid="logo-preview" />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2 flex-1 min-w-[240px]">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                onChange={(e) => uploadLogo(e.target.files?.[0])}
                className="hidden"
                data-testid="logo-file-input"
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || !canEdit}
                  data-testid="logo-upload-btn"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? "Subiendo…" : "Subir desde mi PC"}
                </Button>
                {cfg.logo_url && (
                  <Button type="button" variant="outline" onClick={removeLogo} disabled={!canEdit} data-testid="logo-remove-btn">
                    <Trash2 className="w-4 h-4 mr-2" /> Quitar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Se mostrará en el sidebar en lugar del ícono por defecto. También puedes pegar una URL abajo si lo prefieres.
              </p>
              <div>
                <Label className="text-xs">URL del logo (opcional)</Label>
                <Input value={cfg.logo_url || ""} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://…" data-testid="cfg-logo_url" />
              </div>
            </div>
          </div>
          {!canEdit && (
            <div className="text-xs text-amber-400">Solo dueño o administrador pueden cambiar el logo.</div>
          )}
        </section>

        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h3 className="font-display font-semibold text-lg">Negocio</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Nombre comercial</Label><Input value={cfg.business_name || ""} onChange={(e) => set("business_name", e.target.value)} data-testid="cfg-business_name" /></div>
            <div className="col-span-2"><Label>Razón social</Label><Input value={cfg.legal_name || ""} onChange={(e) => set("legal_name", e.target.value)} /></div>
            <div className="col-span-2"><Label>Domicilio</Label><Textarea value={cfg.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
            <div><Label>Teléfono</Label><Input value={cfg.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
            <div><Label>Email</Label><Input value={cfg.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
            <div><Label>RFC / Tax ID</Label><Input value={cfg.tax_id || ""} onChange={(e) => set("tax_id", e.target.value)} /></div>
            <div><Label>Moneda</Label><Input value={cfg.currency || "MXN"} onChange={(e) => set("currency", e.target.value)} /></div>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h3 className="font-display font-semibold text-lg">Umbrales técnicos</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Umbral alto ONU (dBm)</Label><Input type="number" step="0.1" value={cfg.onu_power_high_threshold} onChange={(e) => set("onu_power_high_threshold", Number(e.target.value))} /></div>
            <div><Label>Umbral bajo ONU (dBm)</Label><Input type="number" step="0.1" value={cfg.onu_power_low_threshold} onChange={(e) => set("onu_power_low_threshold", Number(e.target.value))} /></div>
            <div className="col-span-2"><Label>Minutos para alerta de desconexión</Label><Input type="number" value={cfg.disconnect_alert_minutes} onChange={(e) => set("disconnect_alert_minutes", Number(e.target.value))} data-testid="cfg-disconnect_alert_minutes" /></div>
            <div className="col-span-2">
              <Label>Red / CIDR (para lista de IPs disponibles)</Label>
              <Input value={cfg.network_cidr || ""} onChange={(e) => set("network_cidr", e.target.value)} placeholder="192.168.1.0/24" data-testid="cfg-network_cidr" />
            </div>
            <div className="col-span-2">
              <Label>IPs reservadas (separadas por coma, ej. gateway, DHCP)</Label>
              <Input value={(cfg.network_reserved || []).join(", ")}
                onChange={(e) => set("network_reserved", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
                placeholder="192.168.1.1, 192.168.1.2" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Los umbrales se aplican al panel de OLT/ONUs. La red CIDR alimenta el autocompletado de IPs libres al crear o editar clientes.
          </p>
        </section>
      </div>
    </div>
  );
}
