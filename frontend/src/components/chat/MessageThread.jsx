import { useEffect, useRef, useState } from 'react';
import { getMessages, searchMessages } from '../../api/conversations';
import { getErrorMessage } from '../../utils/errors';
import Avatar from './Avatar';
import LastSeenIndicator from './LastSeenIndicator';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import MessageSearch from './MessageSearch';

// The query goes to MySQL BOOLEAN MODE, where + - < > ( ) ~ * " @ are
// operators (and an unbalanced one is a syntax error). Users type plain
// words, so strip them rather than exposing that syntax.
function sanitizeQuery(raw) {
  return raw.replace(/[+\-<>()~*"@]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Words worth highlighting in the current match. InnoDB ignores tokens
// shorter than innodb_ft_min_token_size (3 here), so highlighting them would
// mark text the search never matched on.
function getHighlightTerms(sanitized) {
  return [...new Set(sanitized.split(' ').filter((t) => t.length >= 3))];
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// ChatLayout mounts a fresh MessageThread per open conversation (keyed on
// conversationId), so every effect below only ever runs once per open —
// no need to guard against conversationId changing under an existing
// instance.
export default function MessageThread({ conversation, currentUserId, socket, isSocketConnected }) {
  const {
    conversationId,
    otherUsername,
    otherLastSeenAt,
    otherLastReadAt: initialOtherLastReadAt,
  } = conversation;

  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [otherLastReadAt, setOtherLastReadAt] = useState(initialOtherLastReadAt);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [activeTerms, setActiveTerms] = useState([]);
  const [searchStatus, setSearchStatus] = useState('idle');
  const [searchError, setSearchError] = useState('');
  const [scrollNonce, setScrollNonce] = useState(0);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef(null);
  const pendingScrollRef = useRef(false);
  const isLoadingOlderRef = useRef(false);

  // Initial history fetch and join the room (covers this socket having
  // connected — or auto-rejoined its existing rooms — before this
  // conversation existed; see the join_conversation comment in
  // backend/src/sockets/index.js). Marking this conversation read is owned
  // by ChatLayout now (it's the one with the sidebar badge/visibility
  // state to keep in sync), not this component.
  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setLoadError('');

    getMessages(conversationId)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load messages'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    socket?.emit('join_conversation', { conversationId });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: new messages append here (never optimistically on
  // send — see MessageInput), and conversation_read moves the "seen"
  // cutoff for the other participant.
  useEffect(() => {
    if (!socket) return undefined;

    function handleNewMessage(message) {
      if (Number(message.conversation_id) !== Number(conversationId)) return;

      setMessages((prev) => [...prev, message]);
    }

    function handleConversationRead(payload) {
      if (Number(payload.conversationId) !== Number(conversationId)) return;
      if (Number(payload.userId) === Number(currentUserId)) return; // our own read receipt echoing back
      setOtherLastReadAt(payload.readAt);
    }

    socket.on('new_message', handleNewMessage);
    socket.on('conversation_read', handleConversationRead);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('conversation_read', handleConversationRead);
    };
  }, [socket, conversationId, currentUserId]);

  // Snap to bottom the moment history finishes loading...
  useEffect(() => {
    if (isLoading) return;
    isNearBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ...and afterwards, only follow new messages down if the user was
  // already near the bottom — never yank someone back while scrolled up
  // reading history.
  useEffect(() => {
    if (isLoading) return;
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }

  // Abort any in-flight search on unmount.
  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const currentMatch = isSearchOpen ? matches[currentMatchIndex] ?? null : null;

  // Bring the current match into view. Only acts when a navigation or new
  // search asked for it (pendingScrollRef), so incoming messages never yank
  // the user back. Initial history is just the latest page, so if the match
  // is older than what is loaded, page older history in (existing `before`
  // cursor) until it is; this effect re-runs after each page lands.
  useEffect(() => {
    if (!currentMatch || isLoading || !pendingScrollRef.current) return;

    const el = scrollRef.current?.querySelector(`[data-message-id="${currentMatch.id}"]`);
    if (el) {
      pendingScrollRef.current = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (isLoadingOlderRef.current) return; // a page is in flight; this effect re-runs when it lands

    const oldest = messages[0];
    if (!oldest || Number(oldest.id) <= Number(currentMatch.id)) {
      pendingScrollRef.current = false;
      return;
    }

    isLoadingOlderRef.current = true;
    getMessages(conversationId, { before: oldest.id, limit: 100 })
      .then((older) => {
        isLoadingOlderRef.current = false;
        if (older.length === 0) {
          pendingScrollRef.current = false;
          return;
        }
        isNearBottomRef.current = false; // keep the "follow new messages" effect from scrolling to bottom
        setMessages((prev) => {
          const have = new Set(prev.map((m) => Number(m.id)));
          return [...older.filter((m) => !have.has(Number(m.id))), ...prev];
        });
      })
      .catch(() => {
        isLoadingOlderRef.current = false;
        pendingScrollRef.current = false;
      });
  }, [currentMatch, scrollNonce, messages, isLoading, conversationId]);

  function requestScrollToMatch() {
    pendingScrollRef.current = true;
    setScrollNonce((n) => n + 1);
  }

  function resetSearchResults() {
    searchRequestIdRef.current += 1; // invalidates any in-flight response
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    pendingScrollRef.current = false;
    setMatches([]);
    setCurrentMatchIndex(0);
    setActiveTerms([]);
    setSearchStatus('idle');
    setSearchError('');
  }

  // Closing clears results but keeps searchQuery for next time.
  function closeSearch() {
    resetSearchResults();
    setIsSearchOpen(false);
  }

  async function submitSearch() {
    resetSearchResults();
    const sanitized = sanitizeQuery(searchQuery);
    if (!sanitized) {
      setSearchStatus('done');
      return;
    }

    const requestId = searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchStatus('loading');

    try {
      const result = await searchMessages(conversationId, sanitized, { signal: controller.signal });
      if (requestId !== searchRequestIdRef.current) return; // a newer search or close superseded this one
      setMatches(result);
      setCurrentMatchIndex(0);
      setActiveTerms(getHighlightTerms(sanitized));
      setSearchStatus('done');
      if (result.length > 0) requestScrollToMatch();
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      setSearchError(getErrorMessage(err, 'Search failed'));
      setSearchStatus('error');
    }
  }

  function stepMatch(delta) {
    if (matches.length === 0) return;
    setCurrentMatchIndex((i) => (i + delta + matches.length) % matches.length);
    requestScrollToMatch();
  }

  function handleSend(body) {
    socket?.emit('send_message', { conversationId, body });
  }

  const lastMineIndex = messages
    .map((m) => Number(m.sender_id))
    .lastIndexOf(Number(currentUserId));
  const seenCutoff = otherLastReadAt ? new Date(otherLastReadAt).getTime() : null;

  return (
    <div className="message-thread">
      <header className="message-thread-header">
        {isSearchOpen ? (
          <MessageSearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSubmit={submitSearch}
            onClose={closeSearch}
            onPrev={() => stepMatch(-1)}
            onNext={() => stepMatch(1)}
            matchCount={matches.length}
            currentIndex={currentMatchIndex}
            status={searchStatus}
            errorMessage={searchError}
          />
        ) : (
          <div className="message-thread-header-content">
            <Avatar username={otherUsername} size={40} />
            <div>
              <h2>{otherUsername}</h2>
              <LastSeenIndicator lastSeenAt={otherLastSeenAt} />
            </div>
            <button
              type="button"
              className="btn btn-ghost message-search-toggle"
              onClick={() => setIsSearchOpen(true)}
              aria-label="Search messages"
              aria-expanded={isSearchOpen}
            >
              <SearchIcon />
            </button>
          </div>
        )}
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={handleScroll}>
        {isLoading && (
          <div className="message-thread-loading">
            <span className="spinner spinner-lg" />
          </div>
        )}

        {!isLoading && loadError && <div className="banner banner-error">{loadError}</div>}

        {!isLoading && !loadError && messages.length === 0 && (
          <div className="message-thread-empty">
            <p>No messages yet.</p>
            <p className="message-thread-empty-sub">Send the first one — say hi 👋</p>
          </div>
        )}

        {!isLoading &&
          !loadError &&
          messages.map((message, index) => {
            const isMine = Number(message.sender_id) === Number(currentUserId);
            const showSeen =
              isMine &&
              index === lastMineIndex &&
              seenCutoff !== null &&
              seenCutoff >= new Date(message.created_at).getTime();

            return (
              <MessageBubble
                key={message.id}
                message={message}
                isMine={isMine}
                showSeen={showSeen}
                highlightTerms={
                  currentMatch && Number(currentMatch.id) === Number(message.id) ? activeTerms : null
                }
              />
            );
          })}

        <div ref={bottomRef} />
      </div>

      <MessageInput onSend={handleSend} disabled={!isSocketConnected} />
    </div>
  );
}
