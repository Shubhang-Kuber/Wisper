// "<username> is typing..." line above the message input. The slot always
// renders at a fixed height so showing/hiding it never shifts the layout, and
// the live region stays mounted so screen readers announce when typing
// starts (the text appears) — heartbeats don't change the DOM, so they
// aren't re-announced.
export default function TypingIndicator({ username, isTyping }) {
  return (
    <div className="typing-indicator" aria-live="polite" aria-atomic="true">
      {isTyping && (
        <>
          <span>{username} is typing</span>
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </>
      )}
    </div>
  );
}
