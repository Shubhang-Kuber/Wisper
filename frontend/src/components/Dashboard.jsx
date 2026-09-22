import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import ChatLayout from './chat/ChatLayout';

// Authenticated app shell: a slim top bar (brand, connection status,
// logout) over the chat UI. Phase 5A left this component as a bare
// placeholder just to prove auth + the socket connection worked end to
// end — this is the real Phase 5B surface built on top of it.
export default function Dashboard() {
  const { username, logout } = useAuth();
  const { isConnected } = useSocket();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-brand">
          <div className="auth-brand-mark app-topbar-mark" />
          <span className="auth-brand-name">Wisper</span>
        </div>

        <div className="app-topbar-right">
          <span className={`status-pill ${isConnected ? 'is-connected' : 'is-connecting'}`}>
            <span className="status-dot" />
            {isConnected ? 'Connected' : 'Connecting…'}
          </span>
          <span className="app-topbar-username">{username}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <ChatLayout />
    </div>
  );
}
