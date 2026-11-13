import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function LoginPage() {
  const { loading, user, admin, error, signInWithGoogle } = useAuth();

  if (!loading && user && admin) return <Navigate to="/reports" replace />;
  if (!loading && user && !admin) return <Navigate to="/denied" replace />;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Retro</p>
        <h1>命運酒館管理後台</h1>
        <p className="lede">請使用已加入管理員白名單的 Google 帳戶登入。非管理員無法查看任何酒館資料。</p>
        {error ? <p className="banner error">{error}</p> : null}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={loading}
          onClick={() => void signInWithGoogle()}
        >
          使用 Google 登入
        </button>
      </div>
    </div>
  );
}
