import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import client from '../../api/client';
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

const draftKey = (conversationId) => `wisper_draft_reply_${conversationId}`;
const pendingKey = (conversationId) => `wisper_pending_replies_${conversationId}`;

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

// Pin endpoints (backend/src/routes/conversations.js). Kept next to their only
// caller rather than in api/conversations.js.
const fetchPins = (conversationId) =>
  client.get(`/conversations/${conversationId}/pins`).then((res) => res.data);
const createPin = (conversationId, messageId, expiryDays) =>
  client
    .post(`/conversations/${conversationId}/pin`, { message_id: messageId, expiry_days: expiryDays })
    .then((res) => res.data);
const deletePin = (conversationId, pinId) =>
  client.delete(`/conversations/${conversationId}/pin/${pinId}`);

const TOAST_MS = 2600;

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
    </svg>
  );
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

  // Reply mode. `replyingTo` is { id, senderName, body, deleted }; the text
  // lives here (not in MessageInput) so drafts can be saved and restored.
  const [replyingTo, setReplyingTo] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [hasDraft, setHasDraft] = useState(() => readJson(draftKey(conversationId), null) !== null);
  const [pending, setPending] = useState(() => readJson(pendingKey(conversationId), []));
  const [flashId, setFlashId] = useState(null);

  // Pins: shared by both participants, fetched on demand (no socket events).
  // Each entry is a GET /pins row: { id, message_id, body, is_active, message_deleted, ... }.
  const [pins, setPins] = useState([]);
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [isPinsLoading, setIsPinsLoading] = useState(false);
  const [pinsError, setPinsError] = useState('');
  const [pinMenu, setPinMenu] = useState(null); // { x, y, pin } — right-click "Unpin" menu inside the modal
  const [toast, setToast] = useState('');

  const toastTimerRef = useRef(null);
  const inputRef = useRef(null);
  const restoredDraftRef = useRef(false);
  const latestReplyStateRef = useRef({ replyingTo: null, inputText: '' });
  const flashTimerRef = useRef(null);
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

  function senderNameFor(senderId) {
    return Number(senderId) === Number(currentUserId) ? 'You' : otherUsername;
  }

  function toReplyTarget(id, original) {
    if (!original) return { id, senderName: '', body: '', deleted: true };
    return { id, senderName: senderNameFor(original.sender_id), body: original.body, deleted: false };
  }

  // Preview data for a message that is a reply. The server joins the original
  // in; the local lookup covers pending (not yet stored) replies. If neither
  // has a body, the original is gone.
  function getReplyRef(message) {
    if (!message.replied_to_message_id) return null;
    const original = messages.find((m) => Number(m.id) === Number(message.replied_to_message_id));
    const body = message.replied_body ?? original?.body;
    if (body == null) return { deleted: true };
    const senderId = message.replied_sender_id ?? original?.sender_id;
    const senderName =
      Number(senderId) === Number(currentUserId)
        ? 'You'
        : message.replied_sender_username ?? otherUsername;
    return { senderName, body, deleted: false };
  }

  // Ancestors of `message`, oldest first, ending with its immediate parent.
  // Each entry is { id, senderName, body, deleted }. The walk stops at the
  // first message that can't be found (shown as "[deleted message]") or at
  // the root of the chain.
  function buildReplyChain(message) {
    const chain = [];
    const ref = getReplyRef(message);
    if (!ref) return chain;
    const parentId = message.replied_to_message_id;
    if (ref.deleted) return [{ id: parentId, senderName: '', body: '', deleted: true }];
    chain.push({ id: parentId, senderName: ref.senderName, body: ref.body, deleted: false });

    const byId = (id) => messages.find((m) => Number(m.id) === Number(id));
    let current = byId(parentId);
    while (current && current.replied_to_message_id) {
      const original = byId(current.replied_to_message_id);
      chain.unshift(toReplyTarget(current.replied_to_message_id, original));
      if (!original) break;
      current = original;
    }
    return chain;
  }

  // Chain shown in the reply box: the ancestors of the message being replied
  // to, then that message itself.
  const replyBoxChain = (() => {
    if (!replyingTo) return null;
    const target = messages.find((m) => Number(m.id) === Number(replyingTo.id));
    return target ? [...buildReplyChain(target), replyingTo] : [replyingTo];
  })();

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Writes the draft (or removes it, if this same reply's text was emptied).
  function persistDraft(repliedId, text) {
    if (text.trim()) {
      localStorage.setItem(
        draftKey(conversationId),
        JSON.stringify({ replied_to_message_id: repliedId, body: text, timestamp: Date.now() })
      );
      setHasDraft(true);
      return;
    }
    const stored = readJson(draftKey(conversationId), null);
    if (stored && Number(stored.replied_to_message_id) === Number(repliedId)) {
      localStorage.removeItem(draftKey(conversationId));
      setHasDraft(false);
    }
  }

  function clearDraft() {
    localStorage.removeItem(draftKey(conversationId));
    setHasDraft(false);
  }

  async function restoreDraft(draft) {
    const id = draft.replied_to_message_id;
    setInputText(draft.body);
    let original = messages.find((m) => Number(m.id) === Number(id));
    if (!original) {
      // Older than the loaded page: `before` is exclusive, so before=id+1, limit=1 is that message.
      try {
        const [found] = await getMessages(conversationId, { before: Number(id) + 1, limit: 1 });
        if (found && Number(found.id) === Number(id)) original = found;
      } catch {
        // leave original undefined; falls back to "[deleted message]"
      }
    }
    setReplyingTo(toReplyTarget(id, original));
    focusInput();
  }

  // Restore an existing draft once, right after history loads.
  useEffect(() => {
    if (isLoading || restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    const draft = readJson(draftKey(conversationId), null);
    if (draft) restoreDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Auto-save the draft 500ms after the last keystroke while in reply mode.
  useEffect(() => {
    if (!replyingTo) return undefined;
    const timer = setTimeout(() => persistDraft(replyingTo.id, inputText), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyingTo, inputText]);

  // Typing followed quickly by closing the tab (or switching conversation,
  // which unmounts this component) shouldn't lose the last <500ms of text.
  useEffect(() => {
    latestReplyStateRef.current = { replyingTo, inputText };
  }, [replyingTo, inputText]);

  useEffect(() => {
    function flush() {
      const { replyingTo: target, inputText: text } = latestReplyStateRef.current;
      if (target && text.trim()) persistDraft(target.id, text);
    }
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SocketContext flushes the offline queue on reconnect and pings this.
  useEffect(() => {
    const refresh = () => setPending(readJson(pendingKey(conversationId), []));
    window.addEventListener('wisper:pending-changed', refresh);
    return () => window.removeEventListener('wisper:pending-changed', refresh);
  }, [conversationId]);

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  function handleReply(message) {
    setReplyingTo(toReplyTarget(message.id, message));
    setSendError('');
    focusInput();
  }

  // Closing reply mode keeps whatever was typed as a draft (or drops the
  // draft if there was nothing typed), then empties the input so the text
  // can't be sent as a plain message by accident.
  function handleCancelReply() {
    if (replyingTo) persistDraft(replyingTo.id, inputText);
    setReplyingTo(null);
    setInputText('');
    setSendError('');
  }

  function handleDraftPillClick() {
    if (replyingTo) {
      focusInput();
      return;
    }
    const draft = readJson(draftKey(conversationId), null);
    if (draft) restoreDraft(draft);
  }

  function jumpToMessage(id) {
    const el = scrollRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(Number(id));
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashId(null), 1600);
  }

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), TOAST_MS);
  }

  function loadPins({ showSpinner = false } = {}) {
    if (showSpinner) setIsPinsLoading(true);
    setPinsError('');
    return fetchPins(conversationId)
      .then(setPins)
      .catch((err) => setPinsError(getErrorMessage(err, 'Could not load pins')))
      .finally(() => setIsPinsLoading(false));
  }

  function openPins() {
    setIsPinsOpen(true);
    loadPins({ showSpinner: pins.length === 0 });
  }

  function closePins() {
    setIsPinsOpen(false);
    setPinMenu(null);
  }

  async function handlePin(message, days) {
    try {
      const pin = await createPin(conversationId, message.id, days);
      // A new pin is the newest active one, which the server sorts first.
      setPins((prev) => [
        { ...pin, body: message.body, sender_id: message.sender_id, message_deleted: false },
        ...prev,
      ]);
      showToast(`Message pinned for ${days === 1 ? '1 day' : `${days} days`}`);
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not pin message'));
    }
  }

  async function handleUnpin(pin) {
    try {
      await deletePin(conversationId, pin.id);
      setPins((prev) => prev.filter((p) => p.id !== pin.id));
      showToast('Message unpinned');
    } catch (err) {
      // Already removed (e.g. by the other participant): drop it from the list too.
      if (err?.response?.status === 404) setPins((prev) => prev.filter((p) => p.id !== pin.id));
      showToast(getErrorMessage(err, 'Could not unpin message'));
    }
  }

  // Scroll to a pinned message. Initial history is just the latest page, so if
  // the message is older than what is loaded, page older history in (existing
  // `before` cursor) until it is, then jump and flash it like a reply jump.
  async function jumpToPin(pin) {
    if (pin.message_deleted) return;
    closePins();

    const id = pin.message_id;
    const isRendered = () => scrollRef.current?.querySelector(`[data-message-id="${id}"]`);

    try {
      let oldestId = messages[0]?.id;
      while (!isRendered() && oldestId != null && Number(oldestId) > Number(id)) {
        const older = await getMessages(conversationId, { before: oldestId, limit: 100 });
        if (older.length === 0) break;
        oldestId = older[0].id;
        isNearBottomRef.current = false; // keep the "follow new messages" effect from scrolling to bottom
        // Render synchronously so the element exists for the jump below.
        flushSync(() =>
          setMessages((prev) => {
            const have = new Set(prev.map((m) => Number(m.id)));
            return [...older.filter((m) => !have.has(Number(m.id))), ...prev];
          })
        );
      }
    } catch {
      // fall through to the not-found toast
    }

    if (isRendered()) jumpToMessage(id);
    else showToast('Could not find that message');
  }

  function handlePinItemContextMenu(e, pin) {
    e.preventDefault();
    e.stopPropagation(); // keep the document-level close handler from closing it straight away
    setPinMenu({ x: e.clientX, y: e.clientY, pin });
  }

  // Initial pins fetch, so bubbles can show their pin icon before the modal is opened.
  useEffect(() => {
    loadPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Escape closes the modal (or, if open, just the Unpin menu — see below).
  useEffect(() => {
    if (!isPinsOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !pinMenu) closePins();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPinsOpen, pinMenu]);

  // Same dismissal rules as the message context menu in MessageBubble.
  useEffect(() => {
    if (!pinMenu) return undefined;
    const close = () => setPinMenu(null);
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
  }, [pinMenu]);

  const activePinnedMessageIds = new Set(
    pins.filter((p) => p.is_active).map((p) => Number(p.message_id))
  );

  function finishReply() {
    clearDraft();
    setReplyingTo(null);
    setInputText('');
    setSendError('');
  }

  function handleSend(body) {
    // Plain messages: unchanged behavior (fire and forget, echo renders it).
    if (!replyingTo) {
      socket?.emit('send_message', { conversationId, body });
      setInputText('');
      return;
    }

    const repliedId = replyingTo.id;
    setSendError('');

    if (!socket?.connected) {
      const queue = readJson(pendingKey(conversationId), []);
      queue.push({ body, replied_to_message_id: repliedId, timestamp: Date.now() });
      localStorage.setItem(pendingKey(conversationId), JSON.stringify(queue));
      setPending(queue);
      finishReply();
      return;
    }

    setIsSending(true);
    socket
      .timeout(10000)
      .emit('send_message', { conversationId, body, replied_to_message_id: repliedId }, (err, res) => {
        setIsSending(false);
        if (err || !res || !res.ok) {
          // Keep the draft and reply mode so nothing typed is lost.
          setSendError((res && res.error) || 'Could not send your reply. Your draft is saved.');
          persistDraft(repliedId, body);
          return;
        }
        finishReply();
      });
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
            <button
              type="button"
              className="btn btn-ghost message-pins-toggle"
              onClick={openPins}
              aria-label="Pinned messages"
              aria-haspopup="dialog"
              aria-expanded={isPinsOpen}
            >
              <PinIcon />
              <span>Pins</span>
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
                replyChain={buildReplyChain(message)}
                onReplyClick={jumpToMessage}
                onReply={handleReply}
                onPin={handlePin}
                isPinned={activePinnedMessageIds.has(Number(message.id))}
                flash={flashId === Number(message.id)}
              />
            );
          })}

        {!isLoading &&
          !loadError &&
          pending.map((p) => {
            const pendingMessage = {
              id: `pending-${p.timestamp}`,
              sender_id: currentUserId,
              body: p.body,
              created_at: new Date(p.timestamp).toISOString(),
              replied_to_message_id: p.replied_to_message_id,
            };
            return (
              <MessageBubble
                key={pendingMessage.id}
                message={pendingMessage}
                isMine
                showSeen={false}
                replyChain={buildReplyChain(pendingMessage)}
                onReplyClick={jumpToMessage}
                pending
              />
            );
          })}

        <div ref={bottomRef} />
      </div>

      {hasDraft && (
        <button type="button" className="draft-pill" onClick={handleDraftPillClick}>
          📝 Draft reply saved
        </button>
      )}
      {sendError && <div className="banner banner-error reply-send-error">{sendError}</div>}

      <MessageInput
        value={inputText}
        onChange={setInputText}
        onSend={handleSend}
        // Replies may be composed (and queued) while offline; plain messages may not.
        disabled={!isSocketConnected && !replyingTo}
        isSending={isSending}
        replyingTo={replyingTo}
        replyChain={replyBoxChain}
        onCancelReply={handleCancelReply}
        inputRef={inputRef}
      />

      {isPinsOpen &&
        createPortal(
          <div
            className="pins-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) closePins();
            }}
          >
            <div className="pins-modal" role="dialog" aria-modal="true" aria-label="Pinned messages">
              <div className="pins-modal-header">
                <h3>Pinned messages</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={closePins}
                  aria-label="Close pinned messages"
                >
                  ✕
                </button>
              </div>

              {isPinsLoading && (
                <div className="pins-status">
                  <span className="spinner" />
                </div>
              )}
              {!isPinsLoading && pinsError && <div className="banner banner-error">{pinsError}</div>}
              {!isPinsLoading && !pinsError && pins.length === 0 && (
                <p className="pins-status">No pinned messages yet.</p>
              )}

              {!isPinsLoading && pins.length > 0 && (
                <ul className="pins-list">
                  {pins.map((pin) => (
                    <li
                      key={pin.id}
                      className={`pins-item${pin.is_active ? '' : ' pins-item-expired'}`}
                      onContextMenu={(e) => handlePinItemContextMenu(e, pin)}
                    >
                      <button
                        type="button"
                        className={`pins-item-body${pin.message_deleted ? ' pins-item-deleted' : ''}`}
                        onClick={() => jumpToPin(pin)}
                        disabled={pin.message_deleted}
                      >
                        <span className="pins-item-text">{pin.body}</span>
                        {!pin.is_active && <span className="pins-item-expired-label">Expired</span>}
                      </button>
                      <button
                        type="button"
                        className="pins-item-unpin"
                        onClick={() => handleUnpin(pin)}
                        aria-label="Unpin message"
                        title="Unpin"
                      >
                        <PinIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body
        )}

      {pinMenu &&
        createPortal(
          <ul className="message-context-menu" style={{ top: pinMenu.y, left: pinMenu.x }} role="menu">
            <li role="none">
              <button type="button" role="menuitem" onClick={() => handleUnpin(pinMenu.pin)}>
                Unpin
              </button>
            </li>
          </ul>,
          document.body
        )}

      {toast &&
        createPortal(
          <div className="toast" role="status" aria-live="polite">
            {toast}
          </div>,
          document.body
        )}
    </div>
  );
}
