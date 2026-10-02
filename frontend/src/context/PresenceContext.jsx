import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocket } from './SocketContext';

const PresenceContext = createContext(null);

// Who is online right now, app-wide. Lives above the chat components because
// MessageThread remounts on every conversation switch and would lose it.
//
// Server events (backend/src/sockets/index.js):
//   presence_snapshot { onlineUserIds }  — sent on every (re)connect; replaces our set
//   user_online       { userId }
//   user_offline      { userId, lastSeenAt }
//
// While our own socket is down we can't know anyone's state, so the set is
// cleared and the next snapshot rebuilds it.
export function PresenceProvider({ children }) {
  const { socket, isConnected } = useSocket();
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [lastSeenById, setLastSeenById] = useState({});

  useEffect(() => {
    if (!socket) return undefined;

    function handleSnapshot({ onlineUserIds } = {}) {
      setOnlineIds(new Set((onlineUserIds || []).map(Number)));
    }
    function handleOnline({ userId } = {}) {
      setOnlineIds((prev) => new Set(prev).add(Number(userId)));
    }
    function handleOffline({ userId, lastSeenAt } = {}) {
      const id = Number(userId);
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (lastSeenAt) setLastSeenById((prev) => ({ ...prev, [id]: lastSeenAt }));
    }

    socket.on('presence_snapshot', handleSnapshot);
    socket.on('user_online', handleOnline);
    socket.on('user_offline', handleOffline);
    return () => {
      socket.off('presence_snapshot', handleSnapshot);
      socket.off('user_online', handleOnline);
      socket.off('user_offline', handleOffline);
    };
  }, [socket]);

  useEffect(() => {
    if (!isConnected) setOnlineIds(new Set());
  }, [isConnected]);

  const isOnline = useCallback((userId) => onlineIds.has(Number(userId)), [onlineIds]);
  // Fresher than the conversation list's otherLastSeenAt once someone goes offline mid-session.
  const lastSeenOverride = useCallback((userId) => lastSeenById[Number(userId)] ?? null, [lastSeenById]);

  const value = useMemo(() => ({ isOnline, lastSeenOverride }), [isOnline, lastSeenOverride]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used within a PresenceProvider');
  return ctx;
}
