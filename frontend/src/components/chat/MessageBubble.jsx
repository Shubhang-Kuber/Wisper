import ReadReceipt from './ReadReceipt';

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// `isMine` drives both position (flipped side) and a distinct fill
// (solid primary vs. a neutral card tone) so sender/receiver read clearly
// apart even at a glance, not just from alignment.
export default function MessageBubble({ message, isMine, showSeen }) {
  return (
    <div className={`message-row ${isMine ? 'mine' : 'theirs'}`}>
      <div className="message-bubble">
        <p className="message-body">{message.body}</p>
        <span className="message-time">{formatTime(message.created_at)}</span>
      </div>
      {isMine && showSeen && <ReadReceipt />}
    </div>
  );
}
