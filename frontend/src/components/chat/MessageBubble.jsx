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
//
// Pin additions (optional): `onPin(message, days)` enables the Pin submenu in
// the right-click menu; `isPinned` shows a pin icon on the bubble (active
// pins only — MessageThread decides).
const PIN_OPTIONS = [
  { days: 1, label: 'Pin for 1 day' },
  { days: 7, label: 'Pin for 7 days' },
  { days: 30, label: 'Pin for 1 month' },
];
// Width the context menu plus its submenu need; past this the submenu opens leftwards.
const SUBMENU_FLIP_WIDTH = 320;

export default function MessageBubble({
  message,
  isMine,
  showSeen,
  highlightTerms,
  replyChain,
  onReplyClick,
  onReply,
  onPin,
  isPinned,
  pending,
  flash,
}) {
  const [menu, setMenu] = useState(null);
  const [isPinSubmenuOpen, setIsPinSubmenuOpen] = useState(false);

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
    setIsPinSubmenuOpen(false);
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      className={`message-row ${isMine ? 'mine' : 'theirs'}${flash ? ' message-flash' : ''}`}
      data-message-id={message.id}
      onContextMenu={handleContextMenu}
    >
      <div className="message-bubble">
        {isPinned && (
          <span className="message-pin-icon" role="img" aria-label="Pinned">
            📌
          </span>
        )}
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
            <li
              role="none"
              className="message-context-menu-parent"
              onMouseEnter={() => onPin && setIsPinSubmenuOpen(true)}
              onMouseLeave={() => setIsPinSubmenuOpen(false)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isPinSubmenuOpen}
                disabled={!onPin}
                onClick={(e) => {
                  e.stopPropagation(); // Pin only opens the submenu; don't let the document handler close the menu
                  setIsPinSubmenuOpen((open) => !open);
                }}
              >
                Pin
                <span className="message-context-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {onPin && isPinSubmenuOpen && (
                <ul
                  className={`message-context-menu message-context-submenu${
                    menu.x + SUBMENU_FLIP_WIDTH > window.innerWidth ? ' flip' : ''
                  }`}
                  role="menu"
                >
                  {PIN_OPTIONS.map(({ days, label }) => (
                    <li key={days} role="none">
                      <button type="button" role="menuitem" onClick={() => onPin(message, days)}>
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
