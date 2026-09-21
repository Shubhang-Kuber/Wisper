import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { login as loginRequest, signup as signupRequest } from '../api/auth';
import { decodeJwtPayload } from '../utils/jwt';

const TOKEN_KEY = 'wisper_token';
const DISPLAY_NAME_KEY = 'wisper_display_name';

const AuthContext = createContext(null);

function readInitialState() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return { token: null, userId: null, username: null };

  const payload = decodeJwtPayload(token);
  if (!payload?.userId) {
    // Token is present but unreadable/expired-looking — don't trust it.
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(DISPLAY_NAME_KEY);
    return { token: null, userId: null, username: null };
  }

  return {
    token,
    userId: payload.userId,
    username: sessionStorage.getItem(DISPLAY_NAME_KEY),
  };
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readInitialState);

  const persist = (token, username) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (username) sessionStorage.setItem(DISPLAY_NAME_KEY, username);
  };

  // POST /api/auth/login returns only { token } — no user info at all
  // (see backend/src/routes/auth.js). The JWT payload itself only carries
  // `userId`. There's no GET /api/users/me either, so on a plain login we
  // genuinely have no username to show — the email the person typed is the
  // best available display label until 5B needs more than that.
  const login = useCallback(async ({ email, password }) => {
    const { token } = await loginRequest({ email, password });
    const payload = decodeJwtPayload(token);
    if (!payload?.userId) {
      throw new Error('Received an unreadable token from the server');
    }

    persist(token, email);
    setAuth({ token, userId: payload.userId, username: email });
  }, []);

  // POST /api/auth/signup returns { id, username, email } but no token —
  // only /login issues one. We chain straight into a login call with the
  // same credentials so signup still ends in an authenticated session, and
  // since we have the real username right here, we use it instead of the
  // email fallback that a plain login is stuck with.
  const signup = useCallback(async ({ username, email, password }) => {
    await signupRequest({ username, email, password });
    const { token } = await loginRequest({ email, password });
    const payload = decodeJwtPayload(token);
    if (!payload?.userId) {
      throw new Error('Received an unreadable token from the server');
    }

    persist(token, username);
    setAuth({ token, userId: payload.userId, username });
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(DISPLAY_NAME_KEY);
    setAuth({ token: null, userId: null, username: null });
  }, []);

  const value = useMemo(
    () => ({
      token: auth.token,
      userId: auth.userId,
      username: auth.username,
      isAuthenticated: Boolean(auth.token),
      login,
      signup,
      logout,
    }),
    [auth, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
