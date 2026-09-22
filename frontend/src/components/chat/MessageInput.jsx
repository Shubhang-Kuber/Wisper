import { useState } from 'react';

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
export default function MessageInput({ onSend, disabled }) {
  const [value, setValue] = useState('');

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="message-input">
      <textarea
        rows={1}
        placeholder={disabled ? 'Connecting…' : 'Write a message…'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        type="button"
        className="btn btn-primary message-send-btn"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        <SendIcon />
      </button>
    </div>
  );
}
