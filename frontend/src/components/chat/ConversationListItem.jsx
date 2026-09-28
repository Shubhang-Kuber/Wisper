import Avatar from './Avatar';

function formatPreviewTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationListItem({ conversation, isActive, onClick }) {
  const { otherUsername, lastMessageBody, lastMessageAt, unreadCount } = conversation;
  const hasUnread = unreadCount > 0;
  const unreadDisplay = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <button
      type="button"
      className={`conversation-item ${isActive ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <Avatar username={otherUsername} size={44} />
      <div className="conversation-item-body">
        <div className="conversation-item-top">
          <span className="conversation-item-name">{otherUsername}</span>
          <span className="conversation-item-meta">
            {lastMessageAt && (
              <span className="conversation-item-time">{formatPreviewTime(lastMessageAt)}</span>
            )}
            {hasUnread && (
              <span className="conversation-item-badge" aria-label={`${unreadCount} unread messages`}>
                {unreadDisplay}
              </span>
            )}
          </span>
        </div>
        <p className="conversation-item-preview">{lastMessageBody || 'No messages yet'}</p>
      </div>
    </button>
  );
}
