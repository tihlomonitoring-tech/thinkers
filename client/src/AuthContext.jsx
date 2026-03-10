import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { auth as authApi } from './api';

const AuthContext = createContext(null);

/** Inactivity timeout in ms (10 minutes). Log out when there is no user activity for this long. */
const INACTIVITY_MS = 10 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimerRef = useRef(null);

  const loadUser = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const login = async (email, password) => {
    await authApi.login(email, password);
    // Refetch from /auth/me so we get full user (page_roles, tenant_id, etc.) with session
    const data = await authApi.me();
    setUser(data.user ?? null);
  };

  const switchTenant = async (tenantId) => {
    const data = await authApi.switchTenant(tenantId);
    await loadUser();
    return data;
  };

  // Inactivity timeout: log out after 10 minutes with no activity (keeps the system secure and efficient)
  useEffect(() => {
    if (!user) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const scheduleLogout = () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(() => {
        inactivityTimerRef.current = null;
        logout();
      }, INACTIVITY_MS);
    };

    const onActivity = () => scheduleLogout();

    scheduleLogout();

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity));

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh: loadUser, switchTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
