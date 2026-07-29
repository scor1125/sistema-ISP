import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(()=>{ (async ()=>{ setCfg((await api.get("/config")).data); })(); }, []);

  const set = (k,v) => setCfg((s)=>({...s, [k]: v}));
  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...cfg };
      delete payload.id; delete payload.updated_at;
      await api.put("/config", payload);
      toast.success("Configuración guardada");
    } catch(e){ toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  if (!cfg) return null;

  return (
    <div>
      <PageHeader title="Configuración"
        subtitle="Información del negocio y umbrales técnicos."
        actions={<Button onClick={save} disabled={saving} data-testid="save-config">{saving?"Guardando…":"Guardar cambios"}</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h3 className="font-display font-semibold text-lg">Negocio</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Nombre comercial</Label><Input value={cfg.business_name||""} onChange={(e)=>set("business_name", e.target.value)} data-testid="cfg-business_name" /></div>
            <div className="col-span-2"><Label>Razón social</Label><Input value={cfg.legal_name||""} onChange={(e)=>set("legal_name", e.target.value)} /></div>
            <div className="col-span-2"><Label>Domicilio</Label><Textarea value={cfg.address||""} onChange={(e)=>set("address", e.target.value)} /></div>
            <div><Label>Teléfono</Label><Input value={cfg.phone||""} onChange={(e)=>set("phone", e.target.value)} /></div>
            <div><Label>Email</Label><Input value={cfg.email||""} onChange={(e)=>set("email", e.target.value)} /></div>
            <div><Label>RFC / Tax ID</Label><Input value={cfg.tax_id||""} onChange={(e)=>set("tax_id", e.target.value)} /></div>
            <div><Label>Moneda</Label><Input value={cfg.currency||"MXN"} onChange={(e)=>set("currency", e.target.value)} /></div>
            <div className="col-span-2"><Label>URL del logo</Label><Input value={cfg.logo_url||""} onChange={(e)=>set("logo_url", e.target.value)} /></div>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h3 className="font-display font-semibold text-lg">Umbrales técnicos</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Umbral alto ONU (dBm)</Label><Input type="number" step="0.1" value={cfg.onu_power_high_threshold} onChange={(e)=>set("onu_power_high_threshold", Number(e.target.value))} /></div>
            <div><Label>Umbral bajo ONU (dBm)</Label><Input type="number" step="0.1" value={cfg.onu_power_low_threshold} onChange={(e)=>set("onu_power_low_threshold", Number(e.target.value))} /></div>
            <div className="col-span-2"><Label>Minutos para alerta de desconexión</Label><Input type="number" value={cfg.disconnect_alert_minutes} onChange={(e)=>set("disconnect_alert_minutes", Number(e.target.value))} data-testid="cfg-disconnect_alert_minutes"/></div>
          </div>
          <p className="text-xs text-muted-foreground">
            Los umbrales se aplican al panel de OLT/ONUs para resaltar potencias fuera de rango.
          </p>
        </section>
      </div>
    </div>
  );
}
