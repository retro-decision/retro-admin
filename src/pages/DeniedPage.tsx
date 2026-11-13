import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function DeniedPage() {
  const { loading, user, admin, signOut } = useAuth();

  if (!loading && !user) return <Navigate to="/login" replace />;
  if (!loading && user && admin) return <Navigate to="/reports" replace />;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">存取被拒</p>
        <h1>你不是管理員</h1>
        <p className="lede">
          這個帳戶沒有命運酒館管理權限，因此不會顯示任何檢舉、帖文或用戶資料。若你應該是管理員，請聯絡營運將你的用戶 UUID 加入 <code>help_admins</code> 白名單後再重新登入。
        </p>
        <p className="muted">目前登入：{user?.email ?? user?.id}</p>
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
          登出並更換帳戶
        </button>
      </div>
    </div>
  );
}
