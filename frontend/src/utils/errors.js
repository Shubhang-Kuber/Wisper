// Every backend error handler in this project responds with
// `{ error: '<message>' }` (see backend/src/routes/auth.js — the 409
// duplicate-email case, the 401 invalid-credentials case, the generic 500
// fallback). Pull that string out, with a fallback for network-level
// failures where there's no response at all.
export function getErrorMessage(err, fallback = 'Something went wrong, please try again') {
  return err?.response?.data?.error || fallback;
}
