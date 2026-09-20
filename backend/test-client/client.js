// Throwaway manual testing tool for the Phase 4 real-time layer.
//
// This is NOT part of the actual application or the future frontend — it's
// just a terminal script so a human can drive two Socket.io connections at
// once (one per browser tab / user, in effect) and watch messages flow.
//
// Usage:
//   node test-client/client.js <JWT> <conversationId>
// or, if you omit the arguments, the script will prompt for them.

const { io } = require('socket.io-client');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Small promise wrapper around readline's callback-based question(), so we
// can `await` prompting the user for missing arguments below.
function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  // Accept the token and conversation id as CLI args, or prompt for
  // whichever ones are missing.
  let [, , token, conversationId] = process.argv;

  if (!token) {
    token = await ask('JWT: ');
  }
  if (!conversationId) {
    conversationId = await ask('Conversation ID: ');
  }

  // Connect to the backend, same host/port the REST API listens on since
  // Socket.io shares the HTTP server with Express (see backend/src/index.js).
  // The JWT goes through the `auth` option — NOT a query string — which is
  // where the server's handshake middleware (backend/src/sockets/index.js)
  // expects to find it.
  const socket = io('http://localhost:5000', {
    auth: { token },
  });

  socket.on('connect', () => {
    console.log(`Connected as socket ${socket.id}. Joining conversation ${conversationId}...`);
    // Tells the server to join this socket to the room for a conversation
    // that may have been created after the socket connected (see the
    // join_conversation handler on the server for why this is needed).
    socket.emit('join_conversation', { conversationId });
    console.log('Type a message and press Enter to send. Ctrl+C to quit.\n');
  });

  socket.on('connect_error', (err) => {
    console.error('Connection failed:', err.message);
  });

  // Server pushes every new message for rooms we're in — including our own,
  // since the server broadcasts to the whole room rather than "everyone but
  // the sender".
  socket.on('new_message', (message) => {
    console.log(`\n[message #${message.id}] user ${message.sender_id}: ${message.body}`);
  });

  // Server-side rejections (not a participant, DB write failed, etc.) land
  // here instead of crashing anything.
  socket.on('error', (err) => {
    console.error(`\n[server error] ${err.message}`);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server.');
  });

  // Whatever the user types and hits Enter for becomes the message body.
  rl.on('line', (line) => {
    if (!line.trim()) return;
    socket.emit('send_message', { conversationId, body: line });
  });

  rl.on('close', () => {
    socket.disconnect();
    process.exit(0);
  });
}

main();
