import axios from 'axios';

// The backend serves REST and Socket.io off the same HTTP server (see
// backend/src/index.js), on the port set by backend/.env (PORT=5000).
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const client = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the JWT to every outgoing request, read fresh from sessionStorage
// on each call rather than captured once — this stays correct even if a
// request is in flight around a login/logout.
client.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('wisper_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
