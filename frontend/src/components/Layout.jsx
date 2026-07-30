import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBusinessConfig } from "@/context/BusinessConfigContext";
import {
  LayoutDashboard, Users, CreditCard, MessageCircle, Settings, UserCog,
  Radio, Router, ClipboardList, PackagePlus, Map as MapIcon, ZapOff,
  ListTodo, LogOut, Wifi, Boxes
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import ThemePicker, { initAccentFromStorage } from "@/components/ThemePicker";
import ServersStatus from "@/components/ServersStatus";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, group: "General" },
  { to: "/clientes", label: "Clientes", icon: Users, group: "Operación" },
  { to: "/planes", label: "Planes", icon: PackagePlus, group: "Operación" },
  { to: "/pagos", label: "Pagos", icon: CreditCard, group: "Operación" },
  { to: "/leads", label: "Leads", icon: ClipboardList, group: "Operación" },
  { to: "/extras", label: "Servicios extras", icon: Boxes, group: "Operación" },
  { to: "/mapa", label: "Mapa NAP", icon: MapIcon, group: "Red" },
  { to: "/olt", label: "OLT / ONUs", icon: Radio, group: "Red" },
  { to: "/mikrotik", label: "Mikrotik", icon: Router, group: "Red" },
  { to: "/desconectados", label: "Desconectados", icon: ZapOff, group: "Red" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Comunicación" },
  { to: "/tareas", label: "Tareas / Embudos", icon: ListTodo, group: "Comunicación" },
  { to: "/usuarios", label: "Usuarios sistema", icon: UserCog, group: "Administración" },
  { to: "/configuracion", label: "Configuración", icon: Settings, group: "Administración" },
];

const GROUPED_NAV = (() => {
  const map = new Map();
  NAV.forEach((n) => {
    if (!map.has(n.group)) map.set(n.group, []);
    map.get(n.group).push(n);
  });
  return Array.from(map.entries());
})();

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { config } = useBusinessConfig();
  const groupedNav = useMemo(() => GROUPED_NAV, []);

  const logoUrl = config?.logo_url;
  const businessName = config?.business_name || "NetOps CRM";

  // Restore user's chosen accent color on mount so it persists between reloads.
  useEffect(() => {
    initAccentFromStorage();
  }, []);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col" data-testid="sidebar">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-border">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={businessName}
              className="w-8 h-8 rounded-md object-contain bg-secondary border border-border"
              data-testid="brand-logo"
            />
          ) : (
            <div className="w-8 h-8 rounded-md bg-primary/15 border border-primary/30 grid place-items-center">
              <Wifi className="w-4 h-4 text-primary" />
            </div>
          )}
          <div className="font-display font-bold tracking-tight truncate" data-testid="brand-name">
            {businessName}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {groupedNav.map(([g, items]) => (
            <div key={g} className="mb-3">
              <div className="px-4 mb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{g}</div>
              {items.map(({ to, label, icon: Icon, exact }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={exact}
                  data-testid={`nav-${to.replace('/', '') || 'dashboard'}`}
                  className={({ isActive }) =>
                    `mx-2 my-0.5 flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                    ${isActive
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'}`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Theme picker — user-selectable accent color */}
        <div className="border-t border-border p-3">
          <ThemePicker />
        </div>

        <div className="border-t border-border p-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-secondary grid place-items-center text-xs font-mono">
            {user?.name?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm truncate">{user?.name}</div>
            <Badge variant="outline" className="text-[10px] py-0 h-4 font-mono uppercase">
              {user?.role}
            </Badge>
          </div>
          <Button size="icon" variant="ghost" data-testid="logout-btn"
            onClick={async () => { await logout(); navigate("/login"); }}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-6 gap-3">
          <ServersStatus />
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
