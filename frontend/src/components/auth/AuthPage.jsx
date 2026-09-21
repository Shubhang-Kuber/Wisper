import { useState } from 'react';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';

// Shared shell/card/brand mark around whichever form is active, so
// switching between login and signup doesn't jump the page around.
export default function AuthPage() {
  const [mode, setMode] = useState('login');

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark" />
          <span className="auth-brand-name">Wisper</span>
        </div>

        {mode === 'login' ? (
          <LoginForm onSwitchToSignup={() => setMode('signup')} />
        ) : (
          <SignupForm onSwitchToLogin={() => setMode('login')} />
        )}
      </div>
    </div>
  );
}
