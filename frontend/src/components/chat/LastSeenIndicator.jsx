// `last_seen_at` (backend/src/sockets/index.js) is only ever written on
// socket *disconnect* — there's no "online now" signal anywhere in the
// backend (that would mean touching sockets/index.js, out of scope for
// this phase). So this deliberately renders only what the data actually
// says: when the other participant was last seen. It will look stale
// while they're live in a second window mid-conversation — that's the
// real signal, not a bug in this component.
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

export default function LastSeenIndicator({ lastSeenAt }) {
  return <span className="last-seen">{formatLastSeen(lastSeenAt)}</span>;
}
