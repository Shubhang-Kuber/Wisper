import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReadReceipt from './ReadReceipt';

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function truncate(text, max = 50) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
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
//
// Reply additions (all optional, so existing callers are unaffected):
// `replyChain` ([{ id, senderName, body, deleted }], oldest first) renders the
// quoted chain and `onReplyClick(id)` jumps to a quoted message; `onReply` enables the right-click
// menu (omitted for pending messages); `pending` swaps the time for a
// "Pending" marker; `flash` briefly pulses the bubble after a jump.
export default function MessageBubble({
  message,
  isMine,
  showSeen,
  highlightTerms,
  replyChain,
  onReplyClick,
  onReply,
  pending,
  flash,
}) {
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  function handleContextMenu(e) {
    if (!onReply) return;
    e.preventDefault();
    e.stopPropagation(); // keep the document-level close handler from closing it straight away
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      className={`message-row ${isMine ? 'mine' : 'theirs'}${flash ? ' message-flash' : ''}`}
      data-message-id={message.id}
      onContextMenu={handleContextMenu}
    >
      <div className="message-bubble">
        {replyChain && replyChain.length > 0 && (
          <div className="reply-chain">
            {replyChain.map((quote) => (
              <button
                key={quote.id}
                type="button"
                className={`reply-preview${quote.deleted ? ' reply-preview-deleted' : ''}`}
                onClick={() => onReplyClick?.(quote.id)}
              >
                {quote.deleted
                  ? '[deleted message]'
                  : `${quote.senderName}: ${truncate(quote.body, 30)}`}
              </button>
            ))}
          </div>
        )}
        <p className="message-body">
          {highlightTerms && highlightTerms.length > 0
            ? renderHighlighted(message.body, highlightTerms)
            : message.body}
        </p>
        {pending ? (
          <span className="message-time message-pending">⏳ Pending</span>
        ) : (
          <span className="message-time">{formatTime(message.created_at)}</span>
        )}
      </div>
      {isMine && showSeen && <ReadReceipt />}
      {menu &&
        createPortal(
          <ul className="message-context-menu" style={{ top: menu.y, left: menu.x }} role="menu">
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onReply(message)}
              >
                Reply
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" disabled>
                Pin
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" disabled>
                Delete
              </button>
            </li>
          </ul>,
          document.body
        )}
    </div>
  );
}
