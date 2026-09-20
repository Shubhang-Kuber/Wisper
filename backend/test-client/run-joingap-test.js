// THROWAWAY script for the Phase 4 join_conversation-gap test.
// Does NOT touch client.js or any backend/src file — drives the public
// REST API and socket.io-client API directly, same surface any real client
// would use.
//
// Correct ordering to actually exercise the gap:
//   1. Connect socket A (testuser) FIRST, before the new conversation exists
//      at all. Its auto-join-on-connect query runs now and can't see a
//      conversation that doesn't exist yet.
//   2. AFTER that, create a brand-new conversation via REST (testuser <->
//      a fresh throwaway user D). Socket A is already connected and has no
//      way to know about this new room.
//   3. Connect socket D, join the new conversation, send a message into it.
//   4. Confirm socket A's log shows nothing for that message.
//   5. Socket A emits join_conversation for the new id.
//   6. Socket D sends a second message; confirm socket A now receives it.
//
// Usage: node run-joingap-test.js <tokenA=testuser>
const { io } = require('socket.io-client');

const [, , tokenA] = process.argv;

function connect(label, token) {
  const socket = io('http://localhost:5000', { auth: { token } });
  socket.on('connect', () => console.log(`[${label}] connected, socket ${socket.id}`));
  socket.on('connect_error', (e) => console.log(`[${label}] connect_error: ${e.message}`));
  socket.on('new_message', (m) => console.log(`[${label}] new_message received: #${m.id} conv=${m.conversation_id} "${m.body}"`));
  socket.on('error', (e) => console.log(`[${label}] server error: ${e.message}`));
  return socket;
}

(async () => {
  console.log('>>> Step 1: connect socket A (testuser) before the new conversation exists.\n');
  const socketA = connect('A/testuser', tokenA);
  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n>>> Step 2: NOW create a brand-new conversation via REST (signup+login testuser4, then POST /api/conversations).\n');

  const signupRes = await fetch('http://localhost:5000/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser4', email: 'testuser4@example.com', password: 'testpass123' }),
  });
  console.log('signup raw response:', JSON.stringify(await signupRes.json()));

  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'testuser4@example.com', password: 'testpass123' }),
  });
  const { token: tokenD } = await loginRes.json();
  console.log('testuser4 token (truncated):', tokenD.slice(0, 20) + '...');

  const convRes = await fetch('http://localhost:5000/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenD}` },
    body: JSON.stringify({ otherUserId: 3 }), // 3 = testuser
  });
  const convBody = await convRes.json();
  console.log('new conversation raw response:', JSON.stringify(convBody));
  const newConversationId = convBody.conversationId;

  console.log(`\n>>> Step 3: connect socket D (testuser4), join conversation ${newConversationId}, send a message into it.\n`);
  const socketD = connect('D/testuser4', tokenD);
  await new Promise((r) => setTimeout(r, 1000));

  socketD.emit('join_conversation', { conversationId: newConversationId });
  await new Promise((r) => setTimeout(r, 500));

  socketD.emit('send_message', { conversationId: newConversationId, body: 'message before A has joined - A should NOT see this' });
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n>>> Step 4: (expected: NO [A/testuser] new_message line above for that message — A is not in the room)');
  console.log(`>>> Step 5: socket A emits join_conversation for ${newConversationId}...\n`);

  socketA.emit('join_conversation', { conversationId: newConversationId });
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n>>> Step 6: socket D sends a second message; A should now receive it.\n');
  socketD.emit('send_message', { conversationId: newConversationId, body: 'message after A has joined - A SHOULD see this' });
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n>>> Done. Disconnecting both sockets.');
  socketA.disconnect();
  socketD.disconnect();
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
})();
