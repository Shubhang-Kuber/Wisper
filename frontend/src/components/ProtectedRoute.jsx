import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Route guard: no token (checked synchronously off sessionStorage via
// AuthContext's initial state, so there's no flash of protected content
// before redirecting) means straight back to the login screen.
export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
