import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, UserPlus, LogIn, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const MODES = { login: "login", register: "register" };

export default function Login() {
  const { login, error, setError } = useAuth();
  const [mode, setMode] = useState(MODES.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [regDone, setRegDone] = useState(false);
  const [regError, setRegError] = useState("");

  const onLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(email, password);
    setLoading(false);
  };

  const onRegister = async (e) => {
    e.preventDefault();
    setRegError("");
    if (password.length < 8) { setRegError("La contraseña debe tener al menos 8 caracteres."); return; }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", { email, name, phone, password });
      toast.success("Cuenta creada");
      setRegDone(true);
      setPassword("");
    } catch (err) {
      setRegError(formatApiError(err));
    } finally { setLoading(false); }
  };

  const switchTo = (m) => {
    setMode(m); setRegDone(false); setRegError("");
    if (setError) setError("");
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
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          {/* Tabs */}
          <div className="grid grid-cols-2 rounded-md border border-border bg-card overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => switchTo(MODES.login)}
              className={`px-3 py-2 flex items-center justify-center gap-1 transition-colors ${
                mode === MODES.login ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
              data-testid="tab-login"
            >
              <LogIn className="w-4 h-4" /> Ingresar
            </button>
            <button
              type="button"
              onClick={() => switchTo(MODES.register)}
              className={`px-3 py-2 flex items-center justify-center gap-1 transition-colors ${
                mode === MODES.register ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
              data-testid="tab-register"
            >
              <UserPlus className="w-4 h-4" /> Crear cuenta
            </button>
          </div>

          {mode === MODES.login && (
            <form onSubmit={onLogin} className="space-y-4" data-testid="login-form">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Iniciar sesión</div>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Bienvenido de vuelta</h2>
                <p className="mt-1 text-sm text-muted-foreground">Ingresa con tu cuenta de operador.</p>
              </div>
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
              {error && <div data-testid="login-error" className="text-sm text-destructive">{error}</div>}
              <Button data-testid="login-submit" disabled={loading} type="submit" className="w-full">
                {loading ? "Entrando…" : "Ingresar"}
              </Button>
            </form>
          )}

          {mode === MODES.register && (
            <>
              {regDone ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 flex gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                    <div className="text-sm">
                      <div className="font-medium text-emerald-300">Cuenta creada</div>
                      <p className="text-muted-foreground mt-1">
                        Un administrador debe aprobar tu acceso antes de que puedas ingresar.
                        Te avisará cuando esté listo.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => switchTo(MODES.login)} data-testid="back-to-login">
                    Volver al login
                  </Button>
                </div>
              ) : (
                <form onSubmit={onRegister} className="space-y-4" data-testid="register-form">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Crear cuenta</div>
                    <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Únete al CRM</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Un administrador aprobará tu acceso en minutos.</p>
                  </div>
                  <div>
                    <Label htmlFor="reg-name">Nombre completo</Label>
                    <Input id="reg-name" data-testid="reg-name" value={name}
                      onChange={(e)=>setName(e.target.value)} required autoComplete="name" />
                  </div>
                  <div>
                    <Label htmlFor="reg-email">Correo</Label>
                    <Input id="reg-email" data-testid="reg-email" type="email" value={email}
                      onChange={(e)=>setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div>
                    <Label htmlFor="reg-phone">Teléfono (opcional)</Label>
                    <Input id="reg-phone" data-testid="reg-phone" value={phone}
                      onChange={(e)=>setPhone(e.target.value)} autoComplete="tel" />
                  </div>
                  <div>
                    <Label htmlFor="reg-password">Contraseña (mín. 8)</Label>
                    <Input id="reg-password" data-testid="reg-password" type="password" value={password}
                      onChange={(e)=>setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                  </div>
                  {regError && <div data-testid="register-error" className="text-sm text-destructive">{regError}</div>}
                  <Button data-testid="register-submit" disabled={loading} type="submit" className="w-full">
                    {loading ? "Creando cuenta…" : "Crear cuenta"}
                  </Button>
                </form>
              )}
            </>
          )}

          <div className="text-xs text-muted-foreground font-mono text-center pt-2">
            Creado por <span className="text-primary font-semibold">EnlaceHR</span>
          </div>
        </div>
      </div>
    </div>
  );
}
