# Phase 9: Rate Limiting, Load Balancing and Horizontal Scale

## Context

The 1:1 chat path works (REST, Socket.io rooms, typing, delivered, presence), but it all runs as **one Node process** holding state in memory:

- `backend/src/sockets/presence.js` keeps a `Map` of userId to socketIds. Its own comment says it is single-process only.
- `io.to(room).emit(...)` only reaches sockets on the **same** process.
- Nothing is rate limited. `/api/auth/login` can be brute-forced, `send_message` can be spammed, and the message `body` has no length check.

Goal: make Wisper run as **3 backend instances behind Nginx**, with **Redis** as the shared state and message bus, plus **layered rate limiting** (Nginx at the edge, Express per route, socket events per user). A message sent from a client on instance A must reach a client on instance C. Presence must stay correct across instances. Killing one instance must not lose any chat.

Decisions already made: full scope (rate limiting, load balancing, Redis), Docker Compose for infra, plus a `Scaling_Concepts.md` learning doc.

---

## Target architecture

```
Browser (Vite :5173)
   │  HTTP + WebSocket
   ▼
Nginx :8080  ── limit_req (per IP), least_conn, WS upgrade, passive health checks
   │
   ├── backend1 :5000 ─┐
   ├── backend2 :5000 ─┼── Redis :6379 (Socket.io adapter pub/sub, presence, rate-limit counters)
   └── backend3 :5000 ─┘
             │
             └── MySQL (stays on the host, reached via host.docker.internal)
```

JWT auth is already stateless (handshake in `sockets/index.js:36`, REST in `middleware/auth.js`), so any instance can serve any user without shared sessions.

---

## Step 1: Redis foundation

- New dependencies in `backend/package.json`: `ioredis`, `@socket.io/redis-adapter`, `express-rate-limit`, `rate-limit-redis`.
- New `backend/src/redis.js`: exports one shared `ioredis` client built from `REDIS_URL`, plus `createPubSub()`, which returns `[pub, sub]` duplicates for the adapter. It follows the style of `backend/src/db/index.js`.
- New `backend/src/instance.js`: `INSTANCE_ID = process.env.INSTANCE_ID || os.hostname() + ':' + PORT`. It is used in logs, the `X-Instance-Id` response header and presence keys.
- `backend/src/index.js`:
  - `io.adapter(createAdapter(pub, sub))`, so every `io.to(room).emit` now fans out through Redis pub/sub to all instances. No changes are needed at the emit call sites in `sockets/index.js` or `routes/conversations.js` (which uses `req.app.get('io')`).
  - Startup check pings Redis next to the existing `SELECT 1`.
- Local dev without the full stack: run `docker compose up redis` and keep using `npm run dev`. Redis is always required, so the code has only one path.

## Step 2: Move presence to Redis

Rewrite `backend/src/sockets/presence.js` with the **same exported API**, now async: `add`, `remove`, `isOnline`, `onlineAmong`. Callers keep the same meaning.

Keys:
- `presence:sockets:<userId>` is a SET of `<instanceId>|<socketId>`.
- `presence:online` is a SET of online userIds.
- `presence:instance:<instanceId>` is a SET of `userId|socketId` owned by that instance (used for cleanup).
- `presence:alive:<instanceId>` is a heartbeat string with a 30s TTL, refreshed every 10s.

Atomicity: `add` and `remove` are small **Lua scripts** (`redis.defineCommand`), so the 0→1 and 1→0 transitions are race-free even when two tabs connect to different instances at the same moment. They return `1` only on a transition, which is the same contract as today.

`onlineAmong(ids)` uses one `SMISMEMBER presence:online ...ids` call.

Crash cleanup (an instance dies without running its disconnect handlers): every instance runs a sweeper every 15s. It reads the known instances and, for any instance whose `presence:alive:*` key has expired, calls `remove` for each member in `presence:instance:<deadId>`. For users that go offline this way, it emits `user_offline` to their conversation rooms (from `conversation_participants`) and writes `last_seen_at`. This reuses the same logic as the `disconnect` path.

Changes in `backend/src/sockets/index.js`:
- `const cameOnline = await presence.add(...)`. The `disconnecting` and `disconnect` listeners must still be registered **before** this first await, per the existing comment at line 56, so register them first and then await.
- In `disconnecting`, capture the `conversation:*` room list synchronously, then `await presence.remove(...)` and emit to the captured rooms.
- `presence_snapshot` awaits `presence.onlineAmong(...)`.

## Step 3: REST rate limiting (Express layer)

New `backend/src/middleware/rateLimit.js` builds `express-rate-limit` limiters with a shared `RedisStore` (`rate-limit-redis` using `sendCommand` on the ioredis client), so limits apply **across all instances**:

| Limiter | Applied to | Key | Limit |
|---|---|---|---|
| `loginLimiter` | `POST /api/auth/login` | IP + lower-cased email | 5 / 15 min, `skipSuccessfulRequests: true` |
| `signupLimiter` | `POST /api/auth/signup` | IP | 5 / hour |
| `apiLimiter` | `/api/conversations`, `/api/users` | `req.userId` (after `authenticateToken`), else IP | 120 / min |
| `searchLimiter` | `GET /:id/search`, `GET /users/search` | userId | 30 / min |

- `standardHeaders: 'draft-7'`, `legacyHeaders: false`. Return a 429 with the body `{ error: 'Too many requests, try again in Ns' }` so it matches the existing `{ error }` shape that `frontend/src/utils/errors.js` already reads. Also send a `Retry-After` header.
- `app.set('trust proxy', 1)` in `index.js` so `req.ip` is the real client IP from Nginx's `X-Forwarded-For` and not Nginx's IP.
- `express.json({ limit: '100kb' })` to cap payload size.
- Wiring: the limiters go in the route files (`routes/auth.js`, `routes/conversations.js`, `routes/users.js`) as extra middleware next to `authenticateToken`.

## Step 4: Socket event rate limiting (token bucket in Redis)

New `backend/src/ratelimit/tokenBucket.js`: a **token bucket written by hand as a Lua script** (this is the main learning piece). `take(key, { capacity, refillPerSec, cost = 1 })` returns `{ allowed, retryAfterMs }`. State is a Redis HASH `{tokens, ts}` with a TTL, and it is computed atomically on the server using Redis `TIME`.

Applied in `backend/src/sockets/index.js`:
- **Handshake** (`io.use`): `conn:<ip>` gets 20 connections per minute. This stops reconnect storms and abuse. When the bucket is empty: `next(new Error('Too many connections'))`.
- **`send_message`**: `msg:<userId>` gets a capacity of 10 with a refill of 1/sec. It is keyed by user, not socket, so opening 5 tabs doesn't give 5× the quota. When the bucket is empty: `fail(...)` with `{ ok:false, error:'You are sending messages too fast', retryAfterMs }`. The frontend already shows `res.error` (`MessageThread.jsx:879`) and marks optimistic bubbles as `failed` (`:848`).
- **`join_conversation`**: `join:<userId>` gets a capacity of 20 with a refill of 1/sec.
- **`message_delivered`**: `ack:<userId>` gets a capacity of 100 with a refill of 20/sec, dropped silently like today.
- **`typing`**: keeps the existing per-socket in-memory throttle (`TYPING_THROTTLE_MS`). It is ephemeral and per-connection, so a Redis round trip per keystroke isn't worth it.
- New input validation in `send_message`: `body` must be a non-empty string of at most 4000 chars. Also set Socket.io `maxHttpBufferSize: 1e5`.

## Step 5: Nginx load balancer

New `infra/nginx/nginx.conf`:
- `upstream wisper_backend { least_conn; server backend1:5000 max_fails=3 fail_timeout=10s; ... backend2, backend3 }`
- WebSocket proxying: `proxy_http_version 1.1`, `Upgrade $http_upgrade`, `Connection "upgrade"`, `proxy_read_timeout 75s` (above Socket.io's 25s ping).
- `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto` headers.
- Edge rate limit, the coarse first layer: `limit_req_zone $binary_remote_addr zone=api:10m rate=20r/s;` with `limit_req zone=api burst=40 nodelay;` on `/api/`, and `limit_conn` per IP on `/socket.io/`. It returns 429.
- `add_header X-Upstream $upstream_addr` so you can watch requests move between instances.

**Sticky sessions:** Socket.io's HTTP long-polling transport needs every request of a session to hit the same instance. Instead of `ip_hash` (on localhost every client has the same IP, so everything would land on one instance), the client goes **WebSocket-only**: in `frontend/src/context/SocketContext.jsx`, call `io(API_BASE_URL, { auth: { token }, transports: ['websocket'] })`. One TCP connection then stays on one instance, so stickiness isn't needed. `Scaling_Concepts.md` explains this trade-off.

## Step 6: Docker Compose and instance lifecycle

- New `backend/Dockerfile`: `node:22-slim` (Debian, so `bcrypt` native prebuilds work), `npm ci --omit=dev`, `CMD ["node","src/index.js"]`. Plus a `backend/.dockerignore` (node_modules, .env).
- New root `docker-compose.yml`:
  - `redis:7-alpine` with a healthcheck (`redis-cli ping`)
  - `backend1/2/3` share one YAML anchor: `env_file: backend/.env`, overrides `INSTANCE_ID=backendN`, `REDIS_URL=redis://redis:6379`, `DB_HOST=host.docker.internal`, `extra_hosts: host.docker.internal:host-gateway`, and `depends_on: redis (healthy)`
  - `nginx:1.27-alpine` mounts `infra/nginx/nginx.conf` and publishes `8080:80`
- Frontend: `frontend/.env.local` sets `VITE_API_URL=http://localhost:8080` (`api/client.js` already reads it).
- MySQL note: the host MySQL user must accept connections from Docker (`'user'@'%'`, or `172.%`). This goes in the README.
- `GET /health` in `index.js`: pings MySQL and Redis and returns `{ status, instanceId }` (503 if either fails). It is also used by a compose `healthcheck`.
- **Graceful shutdown** on `SIGTERM`/`SIGINT`: stop accepting connections, call `io.close()` (clients auto-reconnect through Nginx to a healthy instance and rejoin rooms via the existing on-connect logic), remove this instance's presence entries, then `redis.quit()` and `pool.end()`.
- Middleware that sets `X-Instance-Id` on every response.

## Step 7: Frontend touches (small)

- `SocketContext.jsx`: `transports: ['websocket']`, and handle a `connect_error` with the message `'Too many connections'` (log it and let the built-in backoff retry).
- `utils/errors.js`: no change is needed, because the 429 body uses the `{ error }` shape.
- Optional: in `MessageThread.jsx`, when `res.retryAfterMs` is present, show "Slow down, try again in Ns" instead of a generic failure.

## Step 8: Docs

- New `Scaling_Concepts.md` (same style as `Auth_Concepts.md`): fixed window vs sliding window vs token bucket; why rate limit state must be shared (Redis); layered limits (edge vs app vs event); L4 vs L7 load balancing; round-robin vs least_conn vs ip_hash; sticky sessions and Socket.io transports; pub/sub fan-out via the Redis adapter; presence as distributed state with heartbeats and TTLs; graceful shutdown and reconnects; what would come next (Redis Sentinel/Cluster, Kubernetes, MySQL read replicas).
- `PHASE_EXE.md`: add "Phase 9: Rate Limiting and Horizontal Scale" with the deliverables above, and update the 8.4 Redis line to point to it.
- `README.md`: a "Run the scaled stack" section with the commands.

---

## Files

**New:** `backend/src/redis.js`, `backend/src/instance.js`, `backend/src/middleware/rateLimit.js`, `backend/src/ratelimit/tokenBucket.js`, `backend/Dockerfile`, `backend/.dockerignore`, `docker-compose.yml`, `infra/nginx/nginx.conf`, `backend/test-client/load.js`, `Scaling_Concepts.md`

**Modified:** `backend/src/index.js`, `backend/src/sockets/index.js`, `backend/src/sockets/presence.js`, `backend/src/routes/auth.js`, `backend/src/routes/conversations.js`, `backend/src/routes/users.js`, `backend/package.json`, `frontend/src/context/SocketContext.jsx`, `PHASE_EXE.md`, `README.md`

---

## Verification

1. **Stack up:** run `docker compose up --build`, then `curl -i localhost:8080/health` several times. `X-Instance-Id` should cycle between backend1, backend2 and backend3.
2. **Cross-instance delivery:** open two browsers (or a normal and an incognito window) as two users and confirm that `docker compose logs` shows their sockets on different instances. Messages, typing, delivered ✓✓, read receipts and presence dots should all work. New `backend/test-client/load.js` (based on `test-client/client.js`) opens N sockets through `:8080`, sends messages and asserts that every recipient gets `new_message`, whichever instance it is on.
3. **Failover:** run `docker compose stop backend2`. Clients on it reconnect to another instance within a few seconds and rejoin rooms, and chat continues. The peer briefly sees offline then online again. With `docker compose kill backend3` (no graceful shutdown), the sweeper clears its stale presence within about 30s.
4. **REST limits:** 6 bad logins in a row: the 6th returns 429 with `Retry-After`, from any instance. A `for` loop of 200 `curl` requests to `/api/users/search` returns 429, from Nginx first (burst) and then from the app limiter.
5. **Socket limits:** `load.js --spam` sends 30 `send_message` events in 1s. About 10 are acked `ok`, and the rest return `ok:false` with `retryAfterMs`. Opening 25 connections in a minute from one IP gets `connect_error: Too many connections`.
6. **Redis inspection:** `docker compose exec redis redis-cli` lets you check `SMEMBERS presence:online`, `KEYS presence:*` and the `rl:*` keys with their TTLs.
7. **Frontend lint:** run `npm run lint` in `frontend/`.
