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
  const { otherUsername, lastMessageBody, lastMessageAt } = conversation;

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
          {lastMessageAt && (
            <span className="conversation-item-time">{formatPreviewTime(lastMessageAt)}</span>
          )}
        </div>
        <p className="conversation-item-preview">{lastMessageBody || 'No messages yet'}</p>
      </div>
    </button>
  );
}
