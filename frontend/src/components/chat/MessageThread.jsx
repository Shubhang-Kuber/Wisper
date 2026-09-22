import { useEffect, useRef, useState } from 'react';
import { getMessages, markConversationRead } from '../../api/conversations';
import { getErrorMessage } from '../../utils/errors';
import Avatar from './Avatar';
import LastSeenIndicator from './LastSeenIndicator';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';

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

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const isNearBottomRef = useRef(true);

  // Initial history fetch, join the room (covers this socket having
  // connected — or auto-rejoined its existing rooms — before this
  // conversation existed; see the join_conversation comment in
  // backend/src/sockets/index.js), and mark read now that it's open.
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

    markConversationRead(conversationId).catch(() => {
      // Best-effort — a failed read receipt shouldn't block viewing.
    });

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

      // A new message just landed while this thread is open — keep
      // marking it read live instead of waiting for the next time this
      // conversation is opened.
      if (Number(message.sender_id) !== Number(currentUserId)) {
        markConversationRead(conversationId).catch(() => {});
      }
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
        <Avatar username={otherUsername} size={40} />
        <div>
          <h2>{otherUsername}</h2>
          <LastSeenIndicator lastSeenAt={otherLastSeenAt} />
        </div>
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
              <MessageBubble key={message.id} message={message} isMine={isMine} showSeen={showSeen} />
            );
          })}

        <div ref={bottomRef} />
      </div>

      <MessageInput onSend={handleSend} disabled={!isSocketConnected} />
    </div>
  );
}
