import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage } from '../../utils/errors';
import { isValidEmail } from '../../utils/validation';

export default function LoginForm({ onSwitchToSignup }) {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const errors = {};
    if (!email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(email)) errors.email = 'Enter a valid email address';

    if (!password) errors.password = 'Password is required';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      navigate('/', { replace: true });
    } catch (err) {
      // Surfaces the backend's actual message — e.g. the 401 "Invalid
      // credentials" case from backend/src/routes/auth.js — instead of a
      // generic fallback.
      setFormError(getErrorMessage(err, 'Could not log in. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <h1>Welcome back</h1>
      <p className="subtitle">Log in to keep whispering.</p>

      {formError && <div className="banner banner-error" role="alert">{formError}</div>}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className={`field ${fieldErrors.email ? 'has-error' : ''}`}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
        </div>

        <div className={`field ${fieldErrors.password ? 'has-error' : ''}`}>
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting && <span className="spinner" />}
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="auth-switch">
        New to Wisper?{' '}
        <button type="button" onClick={onSwitchToSignup}>
          Create an account
        </button>
      </p>
    </>
  );
}
