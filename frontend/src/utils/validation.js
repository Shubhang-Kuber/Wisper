// Basic format check, not a guarantee of deliverability — the backend is
// the real source of truth (it'll reject a taken email with 409 regardless).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(value.trim());
}
