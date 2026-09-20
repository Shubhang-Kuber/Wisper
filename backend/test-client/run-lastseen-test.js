// THROWAWAY script: spawn one client, let it connect, kill it (simulating a
// disconnect), then let the caller check last_seen_at afterward.
// Usage: node run-lastseen-test.js <token> <conversationId>

const { spawn } = require('child_process');
const path = require('path');

const [, , token, conversationId] = process.argv;
const clientPath = path.join(__dirname, 'client.js');

const child = spawn('node', [clientPath, token, conversationId], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  console.log('=========== RAW STDOUT before kill ===========');
  console.log(stdout);
  console.log('>>> Killing client process now (simulated disconnect)...');
  child.kill();
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
})();
