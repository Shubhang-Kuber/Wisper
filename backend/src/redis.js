const Redis = require('ioredis');
require('dotenv').config();

// Phase 9A: fail fast rather than letting ioredis silently default to localhost.
if (!process.env.REDIS_URL || !process.env.REDIS_URL.trim()) {
  throw new Error('REDIS_URL is not set; add it to backend/.env');
}

const redis = new Redis(process.env.REDIS_URL, {
  // Capped backoff so an outage settles at one reconnect attempt every 5 s.
  retryStrategy: (times) => Math.min(times * 200, 5000),
  // Reject commands quickly while down instead of queueing them indefinitely.
  maxRetriesPerRequest: 1,
});

// Log only the first error of an outage; without a listener ioredis prints
// a full stack trace on every reconnect attempt.
let inOutage = false;

// When localhost resolves to both ::1 and 127.0.0.1, Node reports a refused
// connect as an AggregateError with an empty message; the detail is in errors[].
const describeError = (err) =>
  (err.errors || []).map((e) => e.message).join('; ') ||
  err.message ||
  err.code ||
  String(err);

redis.on('error', (err) => {
  if (inOutage) return;
  inOutage = true;
  console.error('Redis error:', describeError(err));
});

redis.on('ready', () => {
  if (!inOutage) return;
  inOutage = false;
  console.log('Redis connection restored');
});

module.exports = redis;
