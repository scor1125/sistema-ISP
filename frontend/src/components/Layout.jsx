import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBusinessConfig } from "@/context/BusinessConfigContext";
import {
  LayoutDashboard, Users, CreditCard, MessageCircle, Settings, UserCog,
  Radio, Router, ClipboardList, PackagePlus, Map as MapIcon, ZapOff,
  ListTodo, LogOut, Wifi, Boxes, ChevronsLeft, ChevronsRight, StickyNote,
  ChevronUp, ChevronDown, Camera, HandCoins, Calculator, HardHat, BellRing, BatteryCharging
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import ThemePicker, { initThemeFromStorage } from "@/components/ThemePicker";
import ServersStatus from "@/components/ServersStatus";
import PendingBadges from "@/components/PendingBadges";
import InboxWidget from "@/components/InboxWidget";
import CalculatorWidget from "@/components/CalculatorWidget";

const NAV = [
  { to: "/panel", label: "Panel de control", icon: LayoutDashboard, group: "Operación" },
  { to: "/clientes", label: "Clientes", icon: Users, group: "Operación" },
  { to: "/pagos", label: "Pagos", icon: CreditCard, group: "Operación" },
  { to: "/pagos-revisar", label: "Pagos a revisar", icon: HandCoins, group: "Operación" },
  { to: "/energia", label: "Energía de respaldo", icon: BatteryCharging, group: "Operación" },
  { to: "/promesas", label: "Promesas de pagos", icon: HandCoins, group: "Operación" },
  { to: "/arqueos", label: "Arqueo de caja", icon: Calculator, group: "Operación" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Operación" },
  { to: "/planes", label: "Planes", icon: PackagePlus, group: "Red" },
  { to: "/lugares", label: "Lugares", icon: MapIcon, group: "Red" },
  { to: "/extras", label: "Servicios extras", icon: Boxes, group: "Red" },
  { to: "/mapa", label: "Mapa de servicio", icon: MapIcon, group: "Red" },
  { to: "/olt", label: "OLT / ONUs", icon: Radio, group: "Red" },
  { to: "/onus", label: "ONUs Online/Offline", icon: Wifi, group: "Red" },
  { to: "/mikrotik", label: "Mikrotik", icon: Router, group: "Red" },
  { to: "/tareas", label: "Tareas", icon: ListTodo, group: "Sistema" },
  { to: "/colaboradores", label: "Colaboradores", icon: HardHat, group: "Sistema" },
  { to: "/usuarios", label: "Usuarios sistema", icon: UserCog, group: "Sistema" },
  { to: "/configuracion", label: "Configuración", icon: Settings, group: "Sistema" },
];

const GROUPED_NAV = (() => {
  const map = new Map();
  NAV.forEach((n) => {
    if (!map.has(n.group)) map.set(n.group, []);
    map.get(n.group).push(n);
  });
  return Array.from(map.entries());
})();

const COLLAPSE_KEY = "netops-sidebar-collapsed";

export default function Layout() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { config, refresh: refreshConfig, setConfig } = useBusinessConfig();
  const groupedNav = useMemo(() => GROUPED_NAV, []);
  const avatarFileRef = useRef(null);
  const logoFileRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const canEditLogo = ["owner", "admin"].includes(user?.role);

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("La foto excede 2MB."); return; }
    const form = new FormData();
    form.append("file", file);
    setUploadingAvatar(true);
    try {
      await api.post("/auth/me/avatar", form, { headers: { "Content-Type": "multipart/form-data" } });
      await refresh();
      toast.success("Foto actualizada");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploadingAvatar(false); if (avatarFileRef.current) avatarFileRef.current.value = ""; }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (!canEditLogo) { toast.error("Solo el dueño o administrador puede cambiar el logo."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("El logo excede 2MB."); return; }
    const form = new FormData();
    form.append("file", file);
    setUploadingLogo(true);
    try {
      const { data } = await api.post("/config/logo", form, { headers: { "Content-Type": "multipart/form-data" } });
      setConfig((prev) => ({ ...(prev || {}), logo_url: data.logo_url }));
      await refreshConfig();
      toast.success("Logo actualizado");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploadingLogo(false); if (logoFileRef.current) logoFileRef.current.value = ""; }
  };

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  });
  const [headerCollapsed, setHeaderCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("netops-header-collapsed") === "1";
  });

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const toggleHeader = () => {
    setHeaderCollapsed((v) => {
      const next = !v;
      localStorage.setItem("netops-header-collapsed", next ? "1" : "0");
      return next;
    });
  };

  const logoUrl = config?.logo_url;
  const businessName = config?.business_name || "NetOps CRM";

  useEffect(() => { initThemeFromStorage(); }, []);

  const asideWidth = collapsed ? "w-16" : "w-64";

  return (
    <div className="min-h-screen flex bg-background text-foreground relative">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0"
        style={{ backgroundImage: "var(--app-gradient, none)" }}
      />
      <aside
        className={`${asideWidth} shrink-0 border-r border-border bg-card/80 backdrop-blur-md relative z-10 flex flex-col transition-[width] duration-200`}
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
      >
        <div className={`h-14 flex items-center border-b border-border ${collapsed ? "justify-center px-2" : "px-4 gap-2"}`}>
          <input
            ref={logoFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => uploadLogo(e.target.files?.[0])}
            data-testid="logo-file-input"
          />
          <button
            type="button"
            onClick={() => canEditLogo && logoFileRef.current?.click()}
            disabled={!canEditLogo}
            title={canEditLogo ? "Cambiar logo (recomendado 64 × 64 px)" : "Solo dueño/administrador puede cambiar el logo"}
            className={`relative w-10 h-10 rounded-md overflow-hidden shrink-0 group ${canEditLogo ? "hover:ring-2 hover:ring-primary/50 cursor-pointer" : "cursor-default"}`}
            data-testid="brand-logo-btn"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={businessName}
                className="w-10 h-10 object-contain bg-secondary border border-border rounded-md"
                data-testid="brand-logo"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-primary/15 border border-primary/30 grid place-items-center">
                <Wifi className="w-5 h-5 text-primary" />
              </div>
            )}
            {canEditLogo && (
              <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
                <Camera className="w-4 h-4 text-white" />
              </span>
            )}
            {uploadingLogo && (
              <span className="absolute inset-0 bg-black/60 grid place-items-center text-[9px] text-white">…</span>
            )}
          </button>
          {!collapsed && (
            <div
              className="font-display font-black tracking-tight truncate flex-1 text-xl bg-clip-text text-transparent bg-gradient-to-r from-amber-300 via-orange-500 to-rose-600 drop-shadow-[0_2px_10px_rgba(251,146,60,0.3)]"
              data-testid="brand-name"
            >
              EnlaceHR ISP
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={toggle}
              className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Comprimir menú"
              data-testid="sidebar-collapse-btn"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="mx-2 mt-3 mb-1 p-2 rounded-md border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors grid place-items-center"
            title="Expandir menú"
            data-testid="sidebar-expand-btn"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}

        <nav className="flex-1 overflow-y-auto py-3">
          {groupedNav.map(([g, items]) => (
            <div key={g} className="mb-3">
              {!collapsed && groupedNav.length > 1 && (
                <div className="px-4 mb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{g}</div>
              )}
              {items.map(({ to, label, icon: Icon, exact, children }) => (
                <div key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    title={collapsed ? label : undefined}
                    data-testid={`nav-${to.replace('/', '') || 'dashboard'}`}
                    className={({ isActive }) =>
                      `mx-2 my-0.5 flex items-center rounded-md text-sm transition-colors
                      ${collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"}
                      ${isActive
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'}`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                  {!collapsed && children?.map((sub) => (
                    <NavLink
                      key={sub.to}
                      to={sub.to}
                      data-testid={`subnav-${sub.match || sub.to.replace(/[^a-z0-9]/gi, '-')}`}
                      className={({ isActive }) => {
                        // Radix/Router doesn't consider query strings when computing isActive,
                        // so highlight based on the ?tab= match instead.
                        const activeByQuery = typeof window !== "undefined" &&
                          window.location.pathname === to &&
                          window.location.search.includes(`tab=${sub.match}`);
                        const active = activeByQuery || isActive;
                        return `ml-8 mr-2 my-0.5 flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-xs border-l transition-colors
                          ${active
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'}`;
                      }}
                    >
                      <span className="w-1 h-1 rounded-full bg-current opacity-70" />
                      <span className="truncate">{sub.label}</span>
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header
          className={`sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-3 gap-3 transition-[height] duration-200 ${headerCollapsed ? "h-7" : "h-14"}`}
          data-testid="app-header"
          data-collapsed={headerCollapsed ? "true" : "false"}
        >
          {!headerCollapsed && (
            <>
              <ServersStatus />
              <PendingBadges />
              <InboxWidget />
              <div className="ml-auto flex items-center gap-2">
                <CalculatorWidget />
                <ThemePicker />
                <div className="flex items-center pl-2 border-l border-border h-9">
                  <input
                    ref={avatarFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => uploadAvatar(e.target.files?.[0])}
                    data-testid="avatar-file-input"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-md pl-1 pr-2 h-8 hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                        title="Cuenta"
                        data-testid="user-menu-trigger"
                      >
                        <span className="relative w-7 h-7 rounded-md bg-secondary grid place-items-center text-xs font-mono shrink-0 overflow-hidden">
                          {user?.avatar_url ? (
                            <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" data-testid="user-avatar" />
                          ) : (
                            <span>{user?.name?.[0]?.toUpperCase() || "U"}</span>
                          )}
                          {uploadingAvatar && (
                            <span className="absolute inset-0 bg-black/60 grid place-items-center text-[9px] text-white">…</span>
                          )}
                        </span>
                        <div className="hidden md:flex flex-col items-start leading-tight">
                          <span className="text-xs truncate max-w-[120px] font-medium">{user?.name}</span>
                          <Badge variant="outline" className="text-[9px] py-0 h-4 font-mono uppercase">{user?.role}</Badge>
                        </div>
                        <ChevronDown className="w-3 h-3 opacity-60 hidden md:block" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-md bg-secondary grid place-items-center text-xs font-mono shrink-0 overflow-hidden">
                          {user?.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : (user?.name?.[0]?.toUpperCase() || "U")}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm truncate">{user?.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{user?.email}</div>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => avatarFileRef.current?.click()} data-testid="menu-change-avatar">
                        <Camera className="w-4 h-4 mr-2" /> Cambiar foto
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/configuracion")}>
                        <Settings className="w-4 h-4 mr-2" /> Configuración
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={async () => { await logout(); navigate("/login"); }}
                        className="text-destructive focus:text-destructive"
                        data-testid="logout-btn">
                        <LogOut className="w-4 h-4 mr-2" /> Cerrar sesión
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={toggleHeader}
            className={`${headerCollapsed ? "ml-auto" : ""} p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors`}
            title={headerCollapsed ? "Expandir barra" : "Comprimir barra"}
            data-testid="header-toggle"
          >
            {headerCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </header>
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  );
}
