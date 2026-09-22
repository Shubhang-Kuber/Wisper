function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7 10.5 16.5 5 11" />
    </svg>
  );
}

// Shown only under the sender's most recent message once the other
// participant's last_read_at has caught up to it — see MessageThread's
// `showSeen` calculation, which is the single source of truth for when
// this renders.
export default function ReadReceipt() {
  return (
    <span className="read-receipt">
      <CheckIcon />
      Seen
    </span>
  );
}
