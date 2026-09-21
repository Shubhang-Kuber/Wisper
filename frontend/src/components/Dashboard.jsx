import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

// Placeholder authenticated view for 5A. The real chat UI (conversation
// list, message thread, read receipts) is 5B — this just proves auth +
// the socket connection work end to end.
export default function Dashboard() {
  const { username, logout } = useAuth();
  const { isConnected } = useSocket();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const initial = username ? username.trim()[0]?.toUpperCase() : '?';

  return (
    <div className="dashboard-shell">
      <div className="dashboard-avatar">{initial}</div>
      <h1>Logged in as {username}</h1>

      <span className={`status-pill ${isConnected ? 'is-connected' : 'is-connecting'}`}>
        <span className="status-dot" />
        {isConnected ? 'Socket connected' : 'Connecting…'}
      </span>

      <button type="button" className="btn btn-ghost" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
