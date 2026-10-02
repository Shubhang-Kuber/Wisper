// `last_seen_at` (backend/src/sockets/index.js) is written when a user's LAST
// socket closes. Whether they're online *right now* comes from the presence
// events (PresenceContext), passed in as `isOnline`; while online we say so
// instead of showing a stale timestamp.
function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'Last seen unavailable';

  const then = new Date(lastSeenAt).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin <= 0) return 'Last seen moments ago';
  if (diffMin < 60) return `Last seen ${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Last seen ${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `Last seen ${diffDay}d ago`;

  return `Last seen ${new Date(lastSeenAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export default function LastSeenIndicator({ lastSeenAt, isOnline }) {
  return <span className="last-seen">{isOnline ? 'Online' : formatLastSeen(lastSeenAt)}</span>;
}
