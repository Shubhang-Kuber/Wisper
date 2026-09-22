import client from './client';

// GET /api/conversations — list mine (backend/src/routes/conversations.js,
// Phase 5B addition). Each entry already carries the other participant's
// username/last_seen_at and a last-message preview, so the conversation
// list never needs a second round trip per row.
export function listConversations() {
  return client.get('/conversations').then((res) => res.data.conversations);
}

// POST /api/conversations — find-or-create the 1:1 conversation with
// otherUserId. Returns { conversationId, created }.
export function createOrGetConversation(otherUserId) {
  return client.post('/conversations', { otherUserId }).then((res) => res.data);
}

// GET /api/conversations/:id/messages — history, oldest-to-newest.
export function getMessages(conversationId, { before, limit } = {}) {
  return client
    .get(`/conversations/${conversationId}/messages`, { params: { before, limit } })
    .then((res) => res.data.messages);
}

// POST /api/conversations/:id/read — marks read up to now for the
// requesting user, and (Phase 5B scoped backend exception) pushes a
// `conversation_read` socket event to the other participant so their
// "seen" indicator can update live.
export function markConversationRead(conversationId) {
  return client.post(`/conversations/${conversationId}/read`).then((res) => res.data);
}
