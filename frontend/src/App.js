import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BusinessConfigProvider } from "@/context/BusinessConfigContext";
import { initThemeFromStorage } from "@/components/ThemePicker";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Clients from "@/pages/Clients";
import Plans from "@/pages/Plans";
import Payments from "@/pages/Payments";
import PromisesPage from "@/pages/PromisesPage";
import Leads from "@/pages/Leads";
import Extras from "@/pages/Extras";
import NapMap from "@/pages/NapMap";
import WhatsApp from "@/pages/WhatsApp";
import OLT from "@/pages/OLT";
import Mikrotik from "@/pages/Mikrotik";
import Disconnected from "@/pages/Disconnected";
import Tasks from "@/pages/Tasks";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import MyPendings from "@/pages/MyPendings";
import ControlPanel from "@/pages/ControlPanel";
import Arqueos from "@/pages/Arqueos";
import OnusStatus from "@/pages/OnusStatus";
import "@/App.css";

function Protected() {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen grid place-items-center text-muted-foreground">Cargando…</div>;
  if (user === false) return <Navigate to="/login" replace />;
  return (
    <BusinessConfigProvider>
      <Layout />
    </BusinessConfigProvider>
  );
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen grid place-items-center text-muted-foreground">Cargando…</div>;
  if (user && user !== false) return <Navigate to="/" replace />;
  return children;
}

function App() {
  // Apply the saved theme as early as possible so the login page also gets it.
  useEffect(() => { initThemeFromStorage(); }, []);
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route element={<Protected />}>
            <Route path="/" element={<Navigate to="/panel" replace />} />
            <Route path="/panel" element={<ControlPanel />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/planes" element={<Plans />} />
            <Route path="/pagos" element={<Payments />} />
            <Route path="/promesas" element={<PromisesPage />} />
            <Route path="/arqueos" element={<Arqueos />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/extras" element={<Extras />} />
            <Route path="/mapa" element={<NapMap />} />
            <Route path="/olt" element={<OLT />} />
            <Route path="/onus" element={<OnusStatus />} />
            <Route path="/mikrotik" element={<Mikrotik />} />
            <Route path="/desconectados" element={<Disconnected />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/tareas" element={<Tasks />} />
            <Route path="/mis-pendientes" element={<MyPendings />} />
            <Route path="/usuarios" element={<Users />} />
            <Route path="/configuracion" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
