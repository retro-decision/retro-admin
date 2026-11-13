import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout() {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>Retro 命運酒館</strong>
          <span>管理後台</span>
        </div>
        <nav className="nav">
          <NavLink to="/reports" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            檢舉
          </NavLink>
          <NavLink to="/posts" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            全部帖文
          </NavLink>
          <NavLink to="/blocks" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            封鎖帳戶
          </NavLink>
        </nav>
        <div className="session">
          <span className="session-email" title={user?.id}>
            {user?.email ?? user?.id}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            登出
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
