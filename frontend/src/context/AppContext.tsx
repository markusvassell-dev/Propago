import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { api } from '../lib/api';
import { Run } from '../lib/types';
import { applyTheme, savedTheme, persistTheme } from '../lib/theme';
import { useAuth } from './AuthContext';

// App-wide live state: the ~2s runs poll (spec §12 — dashboard reflects truth
// via polling), the toast, and the theme. Transition detection fires the §10
// live-update toasts (dist payloads ready · teammate approvals · auto-runner).

interface AppState {
  runs: Run[];
  refreshRuns: () => Promise<void>;
  toast: string | null;
  showToast: (msg: string) => void;
  dark: boolean;
  toggleDark: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(savedTheme());
  const prevRuns = useRef<Map<string, Run>>(new Map());
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4600);
  }, []);

  const toggleDark = useCallback(() => {
    setDark((d) => {
      const next = !d;
      applyTheme(next);
      persistTheme(next);
      return next;
    });
  }, []);

  const refreshRuns = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get<{ runs: Run[] }>('/api/runs');
      const prev = prevRuns.current;
      if (prev.size) {
        for (const run of r.runs) {
          const old = prev.get(run.id);
          if (old && old.status === 'running' && run.status === 'distreview') {
            showToast(`${run.wf} distribution payloads ready for review`);
          } else if (
            old &&
            old.status === 'review' &&
            run.status === 'running' &&
            run.approvedBy &&
            run.approvedBy !== user.handle
          ) {
            showToast(`${run.approvedBy} approved ${run.wf} from the review queue — moved to deploy`);
          } else if (!old && run.scheduled) {
            showToast(`Auto-runner fired ${run.wf} — scheduled webhook, no manual trigger`);
          }
        }
      }
      prevRuns.current = new Map(r.runs.map((x) => [x.id, x]));
      setRuns(r.runs);
    } catch {
      /* transient poll failure — next tick retries */
    }
  }, [user, showToast]);

  useEffect(() => {
    if (!user) return;
    refreshRuns();
    const iv = window.setInterval(refreshRuns, 2000);
    return () => window.clearInterval(iv);
  }, [user, refreshRuns]);

  return (
    <AppContext.Provider value={{ runs, refreshRuns, toast, showToast, dark, toggleDark }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
