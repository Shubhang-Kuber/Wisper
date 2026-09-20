require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db');
const authRoutes = require('./routes/auth');
const conversationsRoutes = require('./routes/conversations');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);

// Wrap the Express app in a raw HTTP server so Socket.io can attach to the
// same server and both REST and WebSocket traffic share one port.
const httpServer = require('http').createServer(app);

// CORS here mirrors the existing `cors()` Express middleware above, which
// runs with its default config (i.e. reflects/allows any origin). `origin:
// '*'` matches that same permissiveness for the socket handshake rather than
// introducing a stricter or looser policy.
const io = require('socket.io')(httpServer, { cors: { origin: '*' } });
require('./sockets')(io, pool);

const PORT = process.env.PORT;

httpServer.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  try {
    await pool.query('SELECT 1');
    console.log('Database connection succeeded');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
});
