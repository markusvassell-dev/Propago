import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import Shell from './components/Shell';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Orchestrator from './pages/Orchestrator';
import Review from './pages/Review';
import Archive from './pages/Archive';
import Magnets from './pages/Magnets';
import Registry from './pages/Registry';
import Connections from './pages/Connections';
import Settings from './pages/Settings';

// The 10 routes of DESIGN_SPEC §13.10, everything but /login behind the
// AuthContext guard.

export default function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div
        className="mono"
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '.14em',
          color: 'var(--tx3)'
        }}
      >
        restoring session…
      </div>
    );
  }

  // Public routes reachable while signed out (invited users arrive here logged out).
  const PUBLIC = ['/login', '/set-password'];
  if (!user && !PUBLIC.includes(loc.pathname)) return <Navigate to="/login" replace />;
  if (user && loc.pathname === '/login') return <Navigate to="/runs" replace />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/runs" replace />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/orchestrator" element={<Orchestrator />} />
          <Route path="/review" element={<Review />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/magnets" element={<Magnets />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/runs" replace />} />
        </Routes>
      </Shell>
    </AppProvider>
  );
}
