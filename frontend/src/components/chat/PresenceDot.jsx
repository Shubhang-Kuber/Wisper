// Green when online, grey when not. Colour alone isn't enough for assistive
// tech, so the state is also exposed as a label.
export default function PresenceDot({ isOnline }) {
  const label = isOnline ? 'Online' : 'Offline';
  return (
    <span
      className={`presence-dot ${isOnline ? 'is-online' : 'is-offline'}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
