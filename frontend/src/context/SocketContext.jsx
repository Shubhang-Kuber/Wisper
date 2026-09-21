import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { API_BASE_URL } from '../api/client';

const SocketContext = createContext(null);

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
