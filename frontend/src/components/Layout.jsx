import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBusinessConfig } from "@/context/BusinessConfigContext";
import {
  LayoutDashboard, Users, CreditCard, MessageCircle, Settings, UserCog,
  Radio, Router, PackagePlus, Map as MapIcon,
  ListTodo, LogOut, Wifi, Boxes, ChevronsLeft, ChevronsRight,
  Camera, HandCoins, Calculator, HardHat, BatteryCharging,
  AirVent, Menu, ChevronDown, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/sheet";
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
  { to: "/smart-life", label: "Smart Life", icon: AirVent, group: "Operación" },
  { to: "/inventario", label: "Inventario", icon: Package, group: "Operación" },
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

/**
 * Sidebar body — shared between desktop aside and mobile Sheet drawer.
 * `collapsed` only applies on desktop.
 */
function SidebarBody({ collapsed, onNavigate, brand }) {
  const groupedNav = useMemo(() => GROUPED_NAV, []);
  return (
    <>
      <div className={`h-12 flex items-center border-b border-border/50 ${collapsed ? "justify-center px-2" : "px-3 gap-2.5"}`}>
        {brand}
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {groupedNav.map(([g, items]) => (
          <div key={g} className="mb-2">
            {!collapsed && (
              <div className="px-4 mb-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/60 font-mono gold-rule">
                {g}
              </div>
            )}
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                data-testid={`nav-${to.replace('/', '') || 'dashboard'}`}
                className={({ isActive }) =>
                  `group mx-1.5 my-0.5 flex items-center rounded-md text-[13px] transition-colors duration-150
                  ${collapsed ? "justify-center px-2 py-1.5" : "gap-2.5 px-2.5 py-1.5"}
                  ${isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`
                }
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

export default function Layout() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { config, refresh: refreshConfig, setConfig } = useBusinessConfig();
  const avatarFileRef = useRef(null);
  const logoFileRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const logoUrl = config?.logo_url;
  const businessName = config?.business_name || "EnlaceHR ISP";

  useEffect(() => { initThemeFromStorage(); }, []);

  const asideWidth = collapsed ? "w-16" : "w-64";

  // Brand element — reused in desktop aside and mobile drawer
  const brand = (
    <>
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
        className={`relative w-7 h-7 rounded-md overflow-hidden shrink-0 group ring-1 ring-primary/20 ${canEditLogo ? "hover:ring-primary/50 cursor-pointer" : "cursor-default"}`}
        data-testid="brand-logo-btn"
      >
        {logoUrl ? (
          <img src={logoUrl} alt={businessName} className="w-7 h-7 object-contain bg-card" data-testid="brand-logo" />
        ) : (
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary/25 to-primary/5 grid place-items-center">
            <Wifi className="w-3.5 h-3.5 text-primary" />
          </div>
        )}
        {canEditLogo && (
          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
            <Camera className="w-3 h-3 text-white" />
          </span>
        )}
        {uploadingLogo && (
          <span className="absolute inset-0 bg-black/60 grid place-items-center text-[9px] text-white">…</span>
        )}
      </button>
      {!collapsed && (
        <div className="flex-1 min-w-0" data-testid="brand-name">
          <div className="font-heading text-sm leading-none tracking-tight text-foreground truncate">
            {businessName.split(" ")[0] || "EnlaceHR"}
          </div>
          <div className="text-[9px] uppercase tracking-[0.24em] text-primary/70 font-mono mt-0.5 truncate">
            {businessName.split(" ").slice(1).join(" ") || "ISP"}
          </div>
        </div>
      )}
      {!collapsed && (
        <button
          type="button"
          onClick={toggle}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors hidden md:inline-flex"
          title="Comprimir menú"
          data-testid="sidebar-collapse-btn"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground bg-celestial relative">
      {/* Grain overlay */}
      <div aria-hidden className="bg-noise fixed inset-0 -z-0 pointer-events-none" />

      {/* Desktop sidebar */}
      <aside
        className={`${asideWidth} shrink-0 border-r border-border/60 bg-card/70 backdrop-blur-xl relative z-10 flex-col transition-[width] duration-300 hidden md:flex`}
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
      >
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="mx-2 mt-3 mb-1 p-2 rounded-lg border border-border/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors grid place-items-center"
            title="Expandir menú"
            data-testid="sidebar-expand-btn"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}
        <SidebarBody collapsed={collapsed} brand={brand} />
      </aside>

      {/* Mobile drawer (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 bg-card/95 backdrop-blur-xl border-r border-border/60" data-testid="sidebar-mobile">
          <div className="flex flex-col h-full">
            <SidebarBody collapsed={false} brand={brand} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header
          className="sticky top-0 z-30 border-b border-border/50 bg-background/85 backdrop-blur-xl flex items-center px-3 sm:px-4 gap-2 sm:gap-3 h-12"
          data-testid="app-header"
        >
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="md:hidden p-2 -ml-1 rounded-lg hover:bg-accent text-foreground transition-colors"
                data-testid="mobile-nav-toggle"
                aria-label="Abrir menú"
              >
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
          </Sheet>

          {/* Mobile brand (visible only when sidebar hidden) */}
          <div className="md:hidden font-heading text-base truncate">
            {businessName}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <ServersStatus />
            <PendingBadges />
            <InboxWidget />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <CalculatorWidget />
              <ThemePicker />
            </div>
            <div className="flex items-center pl-2 sm:border-l sm:border-border/60 h-9">
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
                    className="flex items-center gap-2 rounded-full pl-1 pr-1 sm:pr-2.5 h-9 hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    title="Cuenta"
                    data-testid="user-menu-trigger"
                  >
                    <span className="relative w-7 h-7 rounded-full bg-secondary grid place-items-center text-xs font-mono shrink-0 overflow-hidden ring-1 ring-border">
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
                      <Badge variant="outline" className="text-[9px] py-0 h-4 font-mono uppercase border-primary/40 text-primary/90">{user?.role}</Badge>
                    </div>
                    <ChevronDown className="w-3 h-3 opacity-60 hidden md:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 rounded-xl">
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <span className="w-9 h-9 rounded-full bg-secondary grid place-items-center text-sm font-mono shrink-0 overflow-hidden ring-1 ring-border">
                      {user?.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : (user?.name?.[0]?.toUpperCase() || "U")}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{user?.name}</div>
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
        </header>
        <main className="flex-1 p-3 sm:p-4 lg:p-6 overflow-x-hidden">
          <Outlet />
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  );
}
