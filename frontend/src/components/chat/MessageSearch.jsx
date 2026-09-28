import { useEffect, useRef } from 'react';

// Presentational search overlay; all state lives in MessageThread.
// Keyboard: Escape closes (from anywhere while open), Enter submits while the
// input has focus, ArrowUp/ArrowDown step through matches (scoped to this
// panel so they never hijack the message composer).
export default function MessageSearch({
  query,
  onQueryChange,
  onSubmit,
  onClose,
  onPrev,
  onNext,
  matchCount,
  currentIndex,
  status, // 'idle' | 'loading' | 'done' | 'error'
  errorMessage,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handlePanelKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onNext();
    }
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
  }

  const hasMatches = matchCount > 0;

  return (
    <div className="message-search" role="search" onKeyDown={handlePanelKeyDown}>
      <div className="message-search-row">
        <input
          ref={inputRef}
          type="text"
          className="message-search-input"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          aria-label="Search messages"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onSubmit}
          disabled={status === 'loading'}
        >
          Search
        </button>
        <span className="message-search-count" aria-live="polite">
          {hasMatches ? `${currentIndex + 1} of ${matchCount}` : '0 of 0'}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm message-search-nav"
          onClick={onPrev}
          disabled={!hasMatches}
          aria-label="Previous match"
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm message-search-nav"
          onClick={onNext}
          disabled={!hasMatches}
          aria-label="Next match"
        >
          ↓
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm message-search-nav"
          onClick={onClose}
          aria-label="Close search"
        >
          ✕
        </button>
      </div>
      {status === 'loading' && <p className="message-search-note">Searching…</p>}
      {status === 'done' && !hasMatches && <p className="message-search-note">No matches found</p>}
      {status === 'error' && <p className="message-search-note message-search-error">{errorMessage}</p>}
    </div>
  );
}
