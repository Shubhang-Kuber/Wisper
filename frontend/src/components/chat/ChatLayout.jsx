import { useCallback, useEffect, useRef, useState } from 'react';
import { createOrGetConversation, listConversations, markConversationRead } from '../../api/conversations';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import ConversationList from './ConversationList';
import MessageThread from './MessageThread';

const UNREAD_TITLE_CAP = 99;

export default function ChatLayout() {
  const { userId } = useAuth();
  const { socket, isConnected } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState(null);

  // Refs mirroring state so the single `new_message`/`visibilitychange`
  // listeners below (registered once) never read a stale
  // selectedConversationId/visibility from a closure captured at mount.
  const selectedConversationIdRef = useRef(null);
  const isVisibleRef = useRef(document.visibilityState === 'visible');
  const markReadInFlightRef = useRef(new Set());
  const originalTitleRef = useRef(document.title);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data.map((c) => ({ ...c, unreadCount: Number(c.unread_count) || 0 })));
      setListError('');
    } catch (err) {
      setListError(getErrorMessage(err, 'Could not load conversations'));
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Marks a conversation read on the server (at most one request in flight
  // per conversation at a time) and zeroes its sidebar badge immediately.
  const markRead = useCallback((conversationId) => {
    setConversations((prev) =>
      prev.map((c) => (c.conversationId === conversationId ? { ...c, unreadCount: 0 } : c))
    );

    if (markReadInFlightRef.current.has(conversationId)) return;
    markReadInFlightRef.current.add(conversationId);
    markConversationRead(conversationId)
      .catch(() => {
        // Best-effort — a failed read receipt shouldn't block viewing.
      })
      .finally(() => {
        markReadInFlightRef.current.delete(conversationId);
      });
  }, []);

  const handleSelectConversation = useCallback(
    (conversationId) => {
      setSelectedConversationId(conversationId);
      if (document.visibilityState === 'visible') {
        markRead(conversationId);
      }
    },
    [markRead]
  );

  // Tab visibility gates whether an open conversation counts as "seen":
  // returning to a visible tab with a conversation open re-marks it read
  // (and zeroes the badge) instead of leaving it stuck at whatever count
  // accrued while the tab was hidden.
  useEffect(() => {
    function handleVisibilityChange() {
      const visible = document.visibilityState === 'visible';
      isVisibleRef.current = visible;
      if (visible && selectedConversationIdRef.current != null) {
        markRead(selectedConversationIdRef.current);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [markRead]);

  // Keeps the sidebar's last-message preview/ordering AND unread badges
  // live for every conversation already in this list snapshot, independent
  // of which one (if any) is open. This is the one `new_message` listener
  // that touches unread counts — MessageThread has its own separate
  // listener for the open thread's message log, which only ever touches
  // its own messages state, so the two never race or double-render.
  useEffect(() => {
    if (!socket) return undefined;

    function handleNewMessage(message) {
      const conversationId = Number(message.conversation_id);
      const isMine = Number(message.sender_id) === Number(userId);
      const isOpenAndVisible =
        conversationId === selectedConversationIdRef.current && isVisibleRef.current;

      setConversations((prev) => {
        const index = prev.findIndex((c) => c.conversationId === conversationId);
        // Not in our list snapshot (e.g. a conversation someone just
        // started with us, before we've reloaded the list) — a known
        // MVP gap, see backend/src/sockets/index.js's join_conversation
        // comment. Reopening/refreshing picks it up.
        if (index === -1) return prev;

        const shouldIncrement = !isMine && !isOpenAndVisible;

        const updated = {
          ...prev[index],
          lastMessageBody: message.body,
          lastMessageAt: message.created_at,
          lastMessageSenderId: message.sender_id,
          unreadCount: shouldIncrement ? prev[index].unreadCount + 1 : prev[index].unreadCount,
        };

        const rest = prev.filter((_, i) => i !== index);
        return [updated, ...rest];
      });

      // The open, visible conversation just got a message from the other
      // person — keep the server's last_read_at current so a refresh
      // doesn't show it as unread again.
      if (!isMine && isOpenAndVisible) {
        markRead(conversationId);
      }
    }

    socket.on('new_message', handleNewMessage);
    return () => socket.off('new_message', handleNewMessage);
  }, [socket, userId, markRead]);

  // Tab title reflects total unread across every conversation, restored
  // to the original title (captured at mount) whenever the total is 0.
  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    document.title =
      total > 0
        ? `(${total > UNREAD_TITLE_CAP ? '99+' : total}) ${originalTitleRef.current}`
        : originalTitleRef.current;
  }, [conversations]);

  // Restore the original tab title on unmount (covers logout, since
  // ChatLayout unmounts when the protected route redirects away).
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current;
    };
  }, []);

  const handleStartConversation = useCallback(
    async (otherUserId) => {
      try {
        const { conversationId } = await createOrGetConversation(otherUserId);
        socket?.emit('join_conversation', { conversationId });
        await loadConversations();
        setSelectedConversationId(conversationId);
      } catch (err) {
        setListError(getErrorMessage(err, 'Could not start conversation'));
      }
    },
    [socket, loadConversations]
  );

  const selectedConversation =
    conversations.find((c) => c.conversationId === selectedConversationId) || null;

  return (
    <div className="chat-layout">
      <ConversationList
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        onSelect={handleSelectConversation}
        onStartConversation={handleStartConversation}
        isLoading={isLoadingList}
      />

      <main className="chat-main">
        {listError && <div className="banner banner-error chat-list-error">{listError}</div>}

        {selectedConversation ? (
          <MessageThread
            key={selectedConversation.conversationId}
            conversation={selectedConversation}
            currentUserId={userId}
            socket={socket}
            isSocketConnected={isConnected}
          />
        ) : (
          <div className="chat-main-empty">
            <p>Select a conversation to start whispering.</p>
          </div>
        )}
      </main>
    </div>
  );
}
