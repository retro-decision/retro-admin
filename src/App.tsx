import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { BlocksPage } from './pages/BlocksPage';
import { PostsPage } from './pages/PostsPage';
import { DeniedPage } from './pages/DeniedPage';
import { LoginPage } from './pages/LoginPage';
import { ReportsPage } from './pages/ReportsPage';

function RequireAdmin() {
  const { loading, user, admin } = useAuth();
  if (loading) {
    return (
      <div className="auth-page">
        <p className="muted">載入中…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!admin) return <Navigate to="/denied" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/denied" element={<DeniedPage />} />
          <Route element={<RequireAdmin />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/reports" replace />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/posts" element={<PostsPage />} />
              <Route path="/blocks" element={<BlocksPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
