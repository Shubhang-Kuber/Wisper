import { useCallback, useEffect, useState } from 'react';
import { createOrGetConversation, listConversations } from '../../api/conversations';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import ConversationList from './ConversationList';
import MessageThread from './MessageThread';

export default function ChatLayout() {
  const { userId } = useAuth();
  const { socket, isConnected } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data);
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

  // Keeps the sidebar's last-message preview/ordering live for every
  // conversation already in this list snapshot, independent of which one
  // (if any) is open. MessageThread has its own `new_message` listener for
  // the open thread's message log — that one only ever touches its own
  // messages state, this one only ever touches the sidebar, so they never
  // race or double-render anything.
  useEffect(() => {
    if (!socket) return undefined;

    function handleNewMessage(message) {
      setConversations((prev) => {
        const conversationId = Number(message.conversation_id);
        const index = prev.findIndex((c) => c.conversationId === conversationId);
        // Not in our list snapshot (e.g. a conversation someone just
        // started with us, before we've reloaded the list) — a known
        // MVP gap, see backend/src/sockets/index.js's join_conversation
        // comment. Reopening/refreshing picks it up.
        if (index === -1) return prev;

        const updated = {
          ...prev[index],
          lastMessageBody: message.body,
          lastMessageAt: message.created_at,
          lastMessageSenderId: message.sender_id,
        };

        const rest = prev.filter((_, i) => i !== index);
        return [updated, ...rest];
      });
    }

    socket.on('new_message', handleNewMessage);
    return () => socket.off('new_message', handleNewMessage);
  }, [socket]);

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
        onSelect={setSelectedConversationId}
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
