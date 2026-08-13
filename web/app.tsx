/**
 * DividendTracker — React App with hash-based routing.
 */
import { useEffect, useState, useCallback } from 'react';
import { api, type AuthUserDTO } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { DividendsPage } from './pages/DividendsPage';
import { SyncPage } from './pages/SyncPage';
import { WidgetSetupPage } from './pages/WidgetSetupPage';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AccountPage } from './pages/AccountPage';

type Route =
  | { name: 'dashboard' }
  | { name: 'portfolio' }
  | { name: 'dividends' }
  | { name: 'sync' }
  | { name: 'widget' }
  | { name: 'account' }
  | { name: 'login' };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  switch (hash) {
    case 'portfolio':
      return { name: 'portfolio' };
    case 'dividends':
      return { name: 'dividends' };
    case 'sync':
      return { name: 'sync' };
    case 'widget-setup':
    case 'widget':
      return { name: 'widget' };
    case 'account':
      return { name: 'account' };
    case 'login':
      return { name: 'login' };
    default:
      return { name: 'dashboard' };
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api.me()
      .then((result) => { if (active) setUser(result.user); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleLogin = useCallback((authenticatedUser: AuthUserDTO) => {
    setUser(authenticatedUser);
    window.location.hash = '#/';
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      window.location.hash = '#/login';
    }
  }, []);

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">正在確認登入狀態…</div>;
  }

  if (!user || route.name === 'login') {
    return (
      <ErrorBoundary>
        <LoginPage onLoggedIn={handleLogin} />
      </ErrorBoundary>
    );
  }

  let page: React.ReactNode;
  switch (route.name) {
    case 'portfolio':
      page = <PortfolioPage />;
      break;
    case 'dividends':
      page = <DividendsPage />;
      break;
    case 'sync':
      page = <SyncPage canManageSchedule={user.role === 'owner'} />;
      break;
    case 'widget':
      page = <WidgetSetupPage />;
      break;
    case 'account':
      page = <AccountPage user={user} />;
      break;
    default:
      page = <DashboardPage />;
  }

  return (
    <ErrorBoundary>
      <Layout currentHash={window.location.hash} user={user} onLogout={handleLogout}>
        {page}
      </Layout>
    </ErrorBoundary>
  );
}
