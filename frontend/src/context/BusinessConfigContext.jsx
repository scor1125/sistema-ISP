import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/**
 * Shares business configuration (name, logo, thresholds, etc.) across the app
 * so the sidebar can render the uploaded logo and other panels can reflect
 * updates immediately without refetching.
 */
const BusinessConfigContext = createContext(null);

export function BusinessConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/config");
      setConfig(data);
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ config, loading, refresh, setConfig }), [config, loading, refresh]);
  return <BusinessConfigContext.Provider value={value}>{children}</BusinessConfigContext.Provider>;
}

export const useBusinessConfig = () => useContext(BusinessConfigContext);
