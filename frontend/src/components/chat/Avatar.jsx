// Deterministic hash → hue, so the same username always renders the same
// color for every viewer (no random colors, no lookup table to maintain).
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return hash;
}

function colorForUsername(username) {
  const hue = Math.abs(hashString(username || '?')) % 360;
  return `hsl(${hue}, 58%, 48%)`;
}

export default function Avatar({ username, size = 40 }) {
  const initial = username ? username.trim()[0]?.toUpperCase() : '?';

  return (
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
  );
}
