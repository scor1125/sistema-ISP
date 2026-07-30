import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Router, Wifi, ShieldCheck } from "lucide-react";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(email, password);
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background text-foreground">
      {/* Left visual panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-grid relative overflow-hidden border-r border-border">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 border border-amber-300/40 grid place-items-center shadow-[0_0_28px_rgba(251,146,60,0.55)]">
            <Wifi className="w-6 h-6 text-white drop-shadow" />
          </div>
          <div
            data-testid="brand-title"
            className="font-display font-black text-4xl xl:text-5xl tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-amber-300 via-orange-500 to-rose-600 drop-shadow-[0_2px_18px_rgba(251,146,60,0.35)]"
          >
            CRM Jupiter
          </div>
        </div>
        <div>
          <h1 className="font-display text-4xl xl:text-5xl font-bold tracking-tight leading-tight">
            Operación de tu ISP,<br/>
            <span className="text-primary">bajo un solo panel.</span>
          </h1>
          <p className="mt-6 text-muted-foreground max-w-md">
            Gestiona clientes, planes, pagos, OLT, Mikrotik, cajas NAP y WhatsApp desde un único centro de control diseñado para técnicos y dueños.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {["Clientes activos","Pagos y facturas","ONU / OLT","Mapa de NAPs"].map((t)=>(
              <div key={t} className="rounded-md border border-border bg-card p-3 text-sm">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">Módulo</div>
                <div className="mt-1 font-medium">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Sesión encriptada · JWT + Cookies httpOnly
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Iniciar sesión</div>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Bienvenido de vuelta</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ingresa con tu cuenta de operador.</p>
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="email">Correo</Label>
              <Input id="email" data-testid="login-email" type="email" value={email}
                onChange={(e)=>setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" data-testid="login-password" type="password" value={password}
                onChange={(e)=>setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
          </div>
          {error && <div data-testid="login-error" className="text-sm text-destructive">{error}</div>}
          <Button data-testid="login-submit" disabled={loading} type="submit" className="w-full">
            {loading ? "Entrando…" : "Ingresar"}
          </Button>
          <div className="text-xs text-muted-foreground font-mono">
            Admin inicial: benjahr1993@gmail.com
          </div>
        </form>
      </div>
    </div>
  );
}
