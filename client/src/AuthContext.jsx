import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { auth as authApi } from './api';
import { subscribeShiftReportComposeActive } from './lib/shiftReportSessionGuard.js';

const AuthContext = createContext(null);

/** Default inactivity timeout (10 minutes). */
const INACTIVITY_MS = 10 * 60 * 1000;
/** While a shift report form is open, allow longer idle time before sign-out. */
const INACTIVITY_MS_SHIFT_REPORT = 3 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimerRef = useRef(null);
  const shiftReportOpenRef = useRef(false);
  const logoutRef = useRef(async () => {});
  const rescheduleInactivityRef = useRef(() => {});

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

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  logoutRef.current = logout;

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!user) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return undefined;
    }

    const scheduleLogout = () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      const timeoutMs = shiftReportOpenRef.current ? INACTIVITY_MS_SHIFT_REPORT : INACTIVITY_MS;
      inactivityTimerRef.current = setTimeout(() => {
        inactivityTimerRef.current = null;
        logoutRef.current();
      }, timeoutMs);
    };

    rescheduleInactivityRef.current = scheduleLogout;

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
  }, [user]);

  useEffect(() => {
    return subscribeShiftReportComposeActive((open) => {
      shiftReportOpenRef.current = open;
      rescheduleInactivityRef.current();
    });
  }, []);

  const login = async (email, password, location) => {
    await authApi.login(email, password, location);
    const data = await authApi.me();
    const u = data.user ?? null;
    setUser(u);
    return u;
  };

  const switchTenant = async (tenantId) => {
    const data = await authApi.switchTenant(tenantId);
    await loadUser();
    return data;
  };

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
