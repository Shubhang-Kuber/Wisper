const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 14,
  height: 14,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20 7 10.5 16.5 5 11" />
    </svg>
  );
}

function DoubleCheckIcon() {
  return (
    <svg {...ICON_PROPS} width={18}>
      <path d="M1.5 12.5 6.5 17.5 16.5 7.5" />
      <path d="M11 15.5 13 17.5 22.5 7.5" />
    </svg>
  );
}

const STATUS = {
  sending: { label: 'Sending', Icon: ClockIcon },
  sent: { label: 'Sent', Icon: CheckIcon },
  delivered: { label: 'Delivered', Icon: DoubleCheckIcon },
  read: { label: 'Read', Icon: DoubleCheckIcon },
};

// Delivery icon shown beside the time on the sender's own messages:
// clock (sending) → ✓ (sent) → ✓✓ (delivered) → green ✓✓ (read).
// `failed` is a text label, not an icon, so it can't be missed.
// MessageThread's `statusOf` decides which state applies.
export default function MessageStatus({ status }) {
  if (status === 'failed') {
    return <span className="message-status is-failed">Not sent</span>;
  }
  const entry = STATUS[status];
  if (!entry) return null;
  const { label, Icon } = entry;
  return (
    <span className={`message-status is-${status}`} role="img" aria-label={label} title={label}>
      <Icon />
    </span>
  );
}
