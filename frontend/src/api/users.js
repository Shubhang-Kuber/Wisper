import client from './client';

// GET /api/users/search?q= (backend/src/routes/users.js, Phase 5B
// addition) — the only way to discover another user to start a
// conversation with; nothing before this phase exposed a user directory.
export function searchUsers(query) {
  const q = (query || '').trim();
  if (!q) return Promise.resolve([]);
  return client.get('/users/search', { params: { q } }).then((res) => res.data.users);
}
