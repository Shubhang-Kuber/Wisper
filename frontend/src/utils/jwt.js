// Minimal JWT payload decoder. This does NOT verify the signature — the
// backend is the only thing that ever needs to trust this token; the
// frontend just needs to read the `userId` claim back out of it (see
// backend/src/routes/auth.js — login signs `{ userId }` and returns only
// the token, no user object). Pulling in a whole library for one base64
// decode isn't worth it.
export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
