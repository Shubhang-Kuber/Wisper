import client from './client';

// POST /api/auth/signup — backend/src/routes/auth.js returns
// { id, username, email } on success. It does NOT return a token; only
// /login does. Signup here is deliberately just the raw call — AuthContext
// is the one that decides to chain it into a login call.
export function signup({ username, email, password }) {
  return client.post('/auth/signup', { username, email, password }).then((res) => res.data);
}

// POST /api/auth/login — returns { token } only (the JWT encodes just
// `userId`, nothing else — see backend/src/routes/auth.js).
export function login({ email, password }) {
  return client.post('/auth/login', { email, password }).then((res) => res.data);
}
