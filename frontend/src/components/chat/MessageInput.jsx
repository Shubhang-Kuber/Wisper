import { useRef } from 'react';
import { truncate } from './MessageBubble';

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9 22 2Z" />
    </svg>
  );
}

// Send on Enter, newline on Shift+Enter. Deliberately does NOT call
// anything that appends a message to local state — see MessageThread,
// which relies solely on the `new_message` socket echo to render sent
// messages, for sender and recipient alike.
//
// The text itself is owned by MessageThread (`value`/`onChange`) because
// drafts have to be saved and restored from outside this component, and
// the thread clears it once a send actually succeeds. When `replyingTo`
// is set, a "Replying to …" box with a close (X) button sits above the row.
// `onUserInput(text)` fires only for text the user actually typed or pasted —
// not for programmatic changes (draft restore, clear after send) — which is
// what the typing indicator keys off.
export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled,
  isSending,
  replyingTo,
  replyChain,
  onCancelReply,
  inputRef,
  onUserInput,
}) {
  // Tracks IME composition (Hindi, Japanese, ...). onChange also fires for the
  // intermediate text, so `onUserInput` is held back until it is committed.
  const isComposingRef = useRef(false);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled || isSending) return;
    onSend(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {replyingTo && (
        <div className="reply-box">
          <div className="reply-box-text">
            <p className="reply-box-title">Replying to:</p>
            {(replyChain ?? [replyingTo]).map((quote) => (
              <p key={quote.id} className="reply-box-quote">
                {quote.deleted
                  ? '> [deleted message]'
                  : `> ${quote.senderName}: ${truncate(quote.body, 30)}`}
              </p>
            ))}
          </div>
          <button
            type="button"
            className="reply-box-close"
            onClick={onCancelReply}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      )}
      <div className="message-input">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={disabled ? 'Connecting…' : 'Write a message…'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isComposingRef.current) onUserInput?.(e.target.value);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            onUserInput?.(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-primary message-send-btn"
          onClick={handleSend}
          disabled={disabled || isSending || !value.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>
    </>
  );
}
