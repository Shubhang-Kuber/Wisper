// Deterministic hash → palette swatch, so the same username always renders
// the same color for every viewer (no random colors, no lookup table to
// maintain). Cycles through the app's fixed accent palette (as CSS custom
// properties, so it stays in sync with the rest of the UI) instead of an
// arbitrary full-hue-wheel color, so avatars never clash with the theme.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return hash;
}

const AVATAR_COLOR_VARS = [
  '--teal',
  '--terracotta',
  '--mustard',
  '--sage',
  '--dusty-rose',
  '--slate-blue',
];

function colorForUsername(username) {
  const index = Math.abs(hashString(username || '?')) % AVATAR_COLOR_VARS.length;
  return `var(${AVATAR_COLOR_VARS[index]})`;
}

// `isOnline` (optional) adds a green presence dot; offline shows nothing here
// (the chat header has its own online/offline PresenceDot).
export default function Avatar({ username, size = 40, unreadCount = 0, isOnline = false }) {
  const initial = username ? username.trim()[0]?.toUpperCase() : '?';
  const hasUnread = unreadCount > 0;
  const unreadDisplay = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <div className="avatar-container">
      <div
        className="avatar"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
          background: colorForUsername(username),
        }}
        aria-hidden="true"
      >
        {initial}
      </div>
      {isOnline && <span className="avatar-online-dot" role="img" aria-label="Online" />}
      {hasUnread && (
        <span className="avatar-badge" aria-label={`${unreadCount} unread messages`}>
          {unreadDisplay}
        </span>
      )}
    </div>
  );
}
