import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage } from '../../utils/errors';
import { isValidEmail } from '../../utils/validation';
import PasswordInput from './PasswordInput';

const MIN_PASSWORD_LENGTH = 8;

export default function SignupForm({ onSwitchToLogin }) {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const errors = {};
    if (!username.trim()) errors.username = 'Username is required';

    if (!email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(email)) errors.email = 'Enter a valid email address';

    if (!password) errors.password = 'Password is required';
    else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await signup({ username: username.trim(), email: email.trim(), password });
      navigate('/', { replace: true });
    } catch (err) {
      // Surfaces the backend's actual message — e.g. the 409 "Username or
      // email is already taken" case from backend/src/routes/auth.js —
      // instead of a generic fallback.
      setFormError(getErrorMessage(err, 'Could not sign up. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <h1>Create your account</h1>
      <p className="subtitle">Quiet conversations, start here.</p>

      {formError && <div className="banner banner-error" role="alert">{formError}</div>}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className={`field ${fieldErrors.username ? 'has-error' : ''}`}>
          <label htmlFor="signup-username">Username</label>
          <input
            id="signup-username"
            type="text"
            autoComplete="username"
            placeholder="jane_doe"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          {fieldErrors.username && <span className="field-error">{fieldErrors.username}</span>}
        </div>

        <div className={`field ${fieldErrors.email ? 'has-error' : ''}`}>
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
        </div>

        <div className={`field ${fieldErrors.password ? 'has-error' : ''}`}>
          <label htmlFor="signup-password">Password</label>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting && <span className="spinner" />}
          {isSubmitting ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToLogin}>
          Log in
        </button>
      </p>
    </>
  );
}
