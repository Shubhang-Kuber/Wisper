// In-memory presence: which sockets each user currently has open. A user is
// "online" while they have at least one. This is deliberately not backed by
// MySQL (and not derived from users.last_seen_at) — it's real-time state that
// is rebuilt as clients reconnect after a server restart.
//
// Single-process only. Running several backend instances would need a shared
// store (e.g. the Socket.io Redis adapter) instead of this Map.
const socketsByUser = new Map(); // userId -> Set<socketId>

// Returns true only on the 0 -> 1 transition (user just came online).
function add(userId, socketId) {
  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
  }
  const wasOffline = sockets.size === 0;
  sockets.add(socketId);
  return wasOffline;
}

// Returns true only on the 1 -> 0 transition (user's last socket just went away).
function remove(userId, socketId) {
  const sockets = socketsByUser.get(userId);
  if (!sockets || !sockets.delete(socketId)) return false;
  if (sockets.size > 0) return false;
  socketsByUser.delete(userId);
  return true;
}

function isOnline(userId) {
  return socketsByUser.has(userId);
}

function onlineAmong(userIds) {
  return userIds.filter(isOnline);
}

module.exports = { add, remove, isOnline, onlineAmong };
