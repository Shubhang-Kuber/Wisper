// THROWAWAY orchestration script for Phase 4 live verification ONLY.
// Not part of the app. Spawns two test-client/client.js instances (one per
// user), simulates one user typing a message via stdin, captures the full
// raw stdout of both, then kills both processes.
//
// Usage: node run-e2e-test.js <tokenA> <tokenB> <conversationId> <messageBody>

const { spawn } = require('child_process');
const path = require('path');

const [, , tokenA, tokenB, conversationId, messageBody] = process.argv;

if (!tokenA || !tokenB || !conversationId || !messageBody) {
  console.error('Usage: node run-e2e-test.js <tokenA> <tokenB> <conversationId> <messageBody>');
  process.exit(1);
}

const clientPath = path.join(__dirname, 'client.js');

function spawnClient(label, token) {
  const child = spawn('node', [clientPath, token, conversationId], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  return {
    label,
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

(async () => {
  const clientA = spawnClient('testuser (A)', tokenA);
  const clientB = spawnClient('testuser2 (B)', tokenB);

  // Give both sockets time to connect and join the room.
  await new Promise((r) => setTimeout(r, 2000));

  console.log(`\n>>> Sending message from client A: "${messageBody}"\n`);
  // Simulate what a human would type into client A's stdin (readline `line`
  // event in client.js triggers on this exactly as it would from a keyboard).
  clientA.child.stdin.write(messageBody + '\n');

  // Give the write -> broadcast -> both clients' `new_message` handler time
  // to complete.
  await new Promise((r) => setTimeout(r, 2500));

  console.log('=========== RAW STDOUT: client A (testuser) ===========');
  console.log(clientA.getStdout());
  console.log('=========== RAW STDERR: client A (testuser) ===========');
  console.log(clientA.getStderr() || '(empty)');

  console.log('=========== RAW STDOUT: client B (testuser2) ===========');
  console.log(clientB.getStdout());
  console.log('=========== RAW STDERR: client B (testuser2) ===========');
  console.log(clientB.getStderr() || '(empty)');

  clientA.child.kill();
  clientB.child.kill();

  // Give kill a moment to actually land before we exit.
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
})();
