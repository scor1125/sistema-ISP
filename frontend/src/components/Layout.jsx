import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBusinessConfig } from "@/context/BusinessConfigContext";
import {
  LayoutDashboard, Users, CreditCard, MessageCircle, Settings, UserCog,
  Radio, Router, ClipboardList, PackagePlus, Map as MapIcon, ZapOff,
  ListTodo, LogOut, Wifi, Boxes, ChevronsLeft, ChevronsRight, StickyNote,
  ChevronUp, ChevronDown, Camera, HandCoins
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import ThemePicker, { initThemeFromStorage } from "@/components/ThemePicker";
import ServersStatus from "@/components/ServersStatus";
import PendingBadges from "@/components/PendingBadges";

const NAV = [
  { to: "/clientes", label: "Clientes", icon: Users, group: "Menú" },
  { to: "/pagos", label: "Pagos", icon: CreditCard, group: "Menú" },
  { to: "/promesas", label: "Promesas de pagos", icon: HandCoins, group: "Menú" },
  { to: "/desconectados", label: "Desconectados", icon: ZapOff, group: "Menú" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Menú" },
  { to: "/planes", label: "Planes", icon: PackagePlus, group: "Menú" },
  { to: "/extras", label: "Servicios extras", icon: Boxes, group: "Menú" },
  { to: "/mapa", label: "Mapa de servicio", icon: MapIcon, group: "Menú" },
  { to: "/olt", label: "OLT / ONUs", icon: Radio, group: "Menú" },
  { to: "/mikrotik", label: "Mikrotik", icon: Router, group: "Menú" },
  { to: "/tareas", label: "Tareas", icon: ListTodo, group: "Menú" },
  { to: "/usuarios", label: "Usuarios sistema", icon: UserCog, group: "Menú" },
  { to: "/configuracion", label: "Configuración", icon: Settings, group: "Menú" },
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
  const { config } = useBusinessConfig();
  const groupedNav = useMemo(() => GROUPED_NAV, []);
  const avatarFileRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={businessName}
              className="w-8 h-8 rounded-md object-contain bg-secondary border border-border shrink-0"
              data-testid="brand-logo"
            />
          ) : (
            <div className="w-8 h-8 rounded-md bg-primary/15 border border-primary/30 grid place-items-center shrink-0">
              <Wifi className="w-4 h-4 text-primary" />
            </div>
          )}
          {!collapsed && (
            <div className="font-display font-bold tracking-tight truncate flex-1" data-testid="brand-name">
              {businessName}
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

        {!collapsed && (
          <div className="border-t border-border p-3">
            <ThemePicker />
          </div>
        )}

        <div className={`border-t border-border p-3 flex items-center ${collapsed ? "justify-center" : "gap-2"}`}>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => uploadAvatar(e.target.files?.[0])}
            data-testid="avatar-file-input"
          />
          <button
            type="button"
            onClick={() => avatarFileRef.current?.click()}
            className="relative w-8 h-8 rounded-md bg-secondary grid place-items-center text-xs font-mono shrink-0 overflow-hidden group hover:ring-2 hover:ring-primary/50 transition"
            title="Cambiar foto de perfil"
            data-testid="avatar-upload"
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" data-testid="user-avatar" />
            ) : (
              <span>{user?.name?.[0]?.toUpperCase() || "U"}</span>
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
              <Camera className="w-3.5 h-3.5 text-white" />
            </span>
            {uploadingAvatar && (
              <span className="absolute inset-0 bg-black/60 grid place-items-center text-[9px] text-white">…</span>
            )}
          </button>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{user?.name}</div>
              <Badge variant="outline" className="text-[10px] py-0 h-4 font-mono uppercase">
                {user?.role}
              </Badge>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            data-testid="logout-btn"
            title="Cerrar sesión"
            onClick={async () => { await logout(); navigate("/login"); }}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="h-14 sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-6 gap-3">
          <ServersStatus />
          <PendingBadges />
          <div className="text-xs text-muted-foreground font-mono ml-auto truncate">
            {user?.email}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  );
}
