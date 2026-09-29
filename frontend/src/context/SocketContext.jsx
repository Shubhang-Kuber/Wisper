import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { API_BASE_URL } from '../api/client';

const SocketContext = createContext(null);

const PENDING_REPLIES_PREFIX = 'wisper_pending_replies_';

// Sends every reply queued while offline (see MessageThread). Each queue is
// removed from localStorage *before* its messages are emitted, so a second
// 'connect' (or a second tab) can never send the same reply twice; a reply
// the server explicitly rejects is put back for the next reconnect.
function flushPendingReplies(sock) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PENDING_REPLIES_PREFIX)) keys.push(key);
  }

  keys.forEach((key) => {
    let queue = [];
    try {
      queue = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      queue = [];
    }
    localStorage.removeItem(key);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const conversationId = Number(key.slice(PENDING_REPLIES_PREFIX.length));
    queue.forEach((msg) => {
      sock.emit(
        'send_message',
        { conversationId, body: msg.body, replied_to_message_id: msg.replied_to_message_id },
        (res) => {
          if (res && res.ok) return;
          let current = [];
          try {
            current = JSON.parse(localStorage.getItem(key) || '[]');
          } catch {
            current = [];
          }
          current.push(msg);
          localStorage.setItem(key, JSON.stringify(current));
          window.dispatchEvent(new Event('wisper:pending-changed'));
        }
      );
    });
  });

  window.dispatchEvent(new Event('wisper:pending-changed'));
}

// Exactly one socket connection for the whole session, established right
// after a valid token exists (fresh login/signup, or one already sitting in
// sessionStorage on app load) and torn down on logout. Nothing else in the
// app should call `io(...)` directly — consume the socket from here.
export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setIsConnected(false);
      return undefined;
    }

    // Backend handshake auth (backend/src/sockets/index.js) reads the JWT
    // off `socket.handshake.auth.token`, verifies it the same way the REST
    // middleware does, and rejects the connection outright if it's missing
    // or invalid.
    const newSocket = io(API_BASE_URL, {
      auth: { token },
    });

    newSocket.on('connect', () => {
      console.log(`[socket] connected successfully (id=${newSocket.id})`);
      setIsConnected(true);
      flushPendingReplies(newSocket);
    });

    newSocket.on('connect_error', (err) => {
      console.error('[socket] connection failed:', err.message);
      setIsConnected(false);
    });

    newSocket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected (${reason})`);
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within a SocketProvider');
  return ctx;
}
