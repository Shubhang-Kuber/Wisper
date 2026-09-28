import ReadReceipt from './ReadReceipt';

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Splits `body` around case-insensitive occurrences of any of `terms` and
// returns React nodes, wrapping each occurrence in a highlighted <span>.
// Built as JSX rather than an HTML string, so message text is always
// escaped by React.
function renderHighlighted(body, terms) {
  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (escaped.length === 0) return body;

  // A capturing group makes split() keep the matches, at odd indexes.
  return body
    .split(new RegExp(`(${escaped.join('|')})`, 'gi'))
    .map((part, i) =>
      i % 2 === 1 ? (
        <span key={i} className="search-highlight">
          {part}
        </span>
      ) : (
        part
      )
    );
}

// `isMine` drives both position (flipped side) and a distinct fill
// (solid primary vs. a neutral card tone) so sender/receiver read clearly
// apart even at a glance, not just from alignment.
// `highlightTerms` (optional) marks matching text inside the body only —
// used by conversation search on the current match.
export default function MessageBubble({ message, isMine, showSeen, highlightTerms }) {
  return (
    <div className={`message-row ${isMine ? 'mine' : 'theirs'}`} data-message-id={message.id}>
      <div className="message-bubble">
        <p className="message-body">
          {highlightTerms && highlightTerms.length > 0
            ? renderHighlighted(message.body, highlightTerms)
            : message.body}
        </p>
        <span className="message-time">{formatTime(message.created_at)}</span>
      </div>
      {isMine && showSeen && <ReadReceipt />}
    </div>
  );
}
