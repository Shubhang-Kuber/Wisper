import { Navigate, Route, Routes } from 'react-router-dom';
import AuthPage from './components/auth/AuthPage';
import Dashboard from './components/Dashboard';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

function LoginRoute() {
  const { isAuthenticated } = useAuth();
  // Already logged in — no reason to show the auth screen again.
  return isAuthenticated ? <Navigate to="/" replace /> : <AuthPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
