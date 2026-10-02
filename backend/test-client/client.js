// Throwaway manual testing tool for the Phase 4 real-time layer.
//
// This is NOT part of the actual application or the future frontend — it's
// just a terminal script so a human can drive two Socket.io connections at
// once (one per browser tab / user, in effect) and watch messages flow.
//
// Usage:
//   node test-client/client.js <JWT> <conversationId> [--ack]
// or, if you omit the arguments, the script will prompt for them.
// --ack makes this client emit `message_delivered` for incoming messages.

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
  const ackDelivery = process.argv.includes('--ack');
  let [, , token, conversationId] = process.argv.filter((arg) => arg !== '--ack');

  // The JWT payload is base64url JSON ({ userId, ... }); decode it so --ack
  // can tell which messages are our own without another round trip.
  const decodeUserId = (jwt) => {
    try {
      return Number(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).userId);
    } catch {
      return NaN;
    }
  };

  if (!token) {
    token = await ask('JWT: ');
  }
  if (!conversationId) {
    conversationId = await ask('Conversation ID: ');
  }

  const myUserId = decodeUserId(token);

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
    // --ack: behave like a real recipient client and acknowledge delivery of
    // other people's messages (see the `message_delivered` server handler).
    if (ackDelivery && Number(message.sender_id) !== myUserId) {
      socket.emit('message_delivered', { messageId: message.id, conversationId: message.conversation_id });
    }
  });

  // Delivery + presence events (backend/src/sockets/index.js).
  socket.on('message_delivered', (payload) => {
    console.log(`\n[delivered] conversation ${payload.conversationId}: messages ${payload.messageIds.join(', ')}`);
  });
  socket.on('presence_snapshot', (payload) => {
    console.log(`\n[presence] online right now: ${payload.onlineUserIds.join(', ') || 'nobody'}`);
  });
  socket.on('user_online', (payload) => {
    console.log(`\n[presence] user ${payload.userId} is ONLINE`);
  });
  socket.on('user_offline', (payload) => {
    console.log(`\n[presence] user ${payload.userId} is OFFLINE (last seen ${payload.lastSeenAt})`);
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
  // Typing indicator hooks: `/typing` and `/stop` emit isTyping true/false
  // for this conversation instead of sending a message.
  socket.on('user_typing', (payload) => {
    console.log(`\n[typing] user ${payload.userId} in conversation ${payload.conversationId}: ${payload.isTyping}`);
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    if (line.trim() === '/typing' || line.trim() === '/stop') {
      socket.emit('typing', { conversationId, isTyping: line.trim() === '/typing' });
      return;
    }
    socket.emit('send_message', { conversationId, body: line });
  });

  rl.on('close', () => {
    socket.disconnect();
    process.exit(0);
  });
}

main();
