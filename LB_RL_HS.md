# Phase 9: Rate Limiting, Load Balancing and Horizontal Scale

## Context

The 1:1 chat path works (REST, Socket.io rooms, typing, delivered, presence), but it all runs as **one Node process** holding state in memory:

- `backend/src/sockets/presence.js` keeps a `Map` of userId to socketIds. Its own comment says it is single-process only.
- `io.to(room).emit(...)` only reaches sockets on the **same** process.
- Nothing is rate limited. `/api/auth/login` can be brute-forced, `send_message` can be spammed, and the message `body` has no length check.

**Goal:** make Wisper run as **3 backend instances behind Nginx**, with **Redis** as the shared state and message bus, plus **layered rate limiting** (Nginx at the edge, Express per route, socket events per user). A message sent from a client on instance A must reach a client on instance C. Presence must stay correct across instances. Killing one instance must not lose any chat.

Decisions already made: full scope (rate limiting, load balancing, Redis), Docker Compose for infra, plus a `Scaling_Concepts.md` learning doc.

## Target architecture (end of Phase 9C)

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

JWT auth is already stateless (handshake in `sockets/index.js`, REST in `middleware/auth.js`), so any instance can serve any user without shared sessions.

---

## How the work is split

| Phase | Name | What you get | Runs as |
|---|---|---|---|
| **9A** | Redis + Rate Limiting | App is protected from spam and brute force | 1 instance + Redis |
| **9B** | Shared State (multi-instance ready) | Chat, typing and presence work across 2+ instances | 2 instances on different ports + Redis |
| **9C** | Load Balancer + Docker | 3 instances behind Nginx, failover, health checks | Full Docker Compose stack |

**Why this order:**
- Each phase works on its own and can be committed and tested before the next one starts.
- 9A needs nothing new except Redis, and it gives you value right away even if you stop there.
- 9B must come before 9C. A load balancer in front of instances that don't share state would break chat, because messages and presence would only be seen by users on the same instance.
- 9C only adds infrastructure around code that already works in 9B.

**Method for every phase:**
1. Create a branch: `git checkout -b phase-9a-rate-limiting` (then `phase-9b-shared-state`, `phase-9c-load-balancer`).
2. Do the steps in the listed order. Each step is small enough to test before moving on.
3. Run that phase's "Done when" checks.
4. Write that phase's section of `Scaling_Concepts.md` while it is fresh.
5. Commit, merge to `main`, then start the next phase.

---

## Phase 9A: Redis + Rate Limiting

**Goal:** protect the single instance you have today. Rate-limit counters go in Redis from the start, so they keep working unchanged when there are 3 instances later.

### Prerequisites
- Install Docker Desktop. For now it is only used to run Redis: `docker run -d --name wisper-redis -p 6379:6379 redis:7-alpine` (in 9C this is replaced by Docker Compose).
- Add `REDIS_URL=redis://localhost:6379` to `backend/.env`.

### Steps (in order)

**Step A1: Redis client**
- `npm install ioredis express-rate-limit rate-limit-redis` in `backend/`.
- New `backend/src/redis.js`: exports one shared `ioredis` client built from `REDIS_URL`. It follows the style of `backend/src/db/index.js`.
- `backend/src/index.js`: at startup, ping Redis next to the existing `SELECT 1` and log success or failure.
- *Test:* start the server and see "Redis connection succeeded".

**Step A2: Basic input limits**
- `express.json({ limit: '100kb' })` in `index.js`.
- Socket.io option `maxHttpBufferSize: 1e5`.
- In `send_message`, `body` must be a non-empty string of at most 4000 chars, otherwise `fail(...)`.
- *Test:* sending an empty or 5000-char message fails with an error.

**Step A3: REST rate limiting (Express layer)**
- New `backend/src/middleware/rateLimit.js` builds `express-rate-limit` limiters with a shared `RedisStore` (`rate-limit-redis` using `sendCommand` on the ioredis client):

| Limiter | Applied to | Key | Limit |
|---|---|---|---|
| `loginLimiter` | `POST /api/auth/login` | IP + lower-cased email | 5 / 15 min, `skipSuccessfulRequests: true` |
| `signupLimiter` | `POST /api/auth/signup` | IP | 5 / hour |
| `apiLimiter` | `/api/conversations`, `/api/users` | `req.userId` (after `authenticateToken`), else IP | 120 / min |
| `searchLimiter` | `GET /:id/search`, `GET /users/search` | userId | 30 / min |

- `standardHeaders: 'draft-7'`, `legacyHeaders: false`. Return a 429 with the body `{ error: 'Too many requests, try again in Ns' }` so it matches the existing `{ error }` shape that `frontend/src/utils/errors.js` already reads. Also send a `Retry-After` header.
- Wiring: the limiters go in the route files (`routes/auth.js`, `routes/conversations.js`, `routes/users.js`) as extra middleware next to `authenticateToken`.
- *Test:* 6 bad logins in a row means the 6th returns 429. The login form shows the message.

**Step A4: Socket event rate limiting (token bucket in Redis)**
- New `backend/src/ratelimit/tokenBucket.js`: a **token bucket written by hand as a Lua script** (this is the main learning piece). `take(key, { capacity, refillPerSec, cost = 1 })` returns `{ allowed, retryAfterMs }`. State is a Redis HASH `{tokens, ts}` with a TTL, and it is computed atomically on the server using Redis `TIME`.
- Applied in `backend/src/sockets/index.js`:
  - **Handshake** (`io.use`): `conn:<ip>` gets 20 connections per minute. When the bucket is empty: `next(new Error('Too many connections'))`.
  - **`send_message`**: `msg:<userId>` gets a capacity of 10 with a refill of 1/sec. It is keyed by user, not socket, so opening 5 tabs doesn't give 5× the quota. When the bucket is empty: `fail(...)` with `{ ok:false, error:'You are sending messages too fast', retryAfterMs }`.
  - **`join_conversation`**: `join:<userId>` gets a capacity of 20 with a refill of 1/sec.
  - **`message_delivered`**: `ack:<userId>` gets a capacity of 100 with a refill of 20/sec, dropped silently like today.
  - **`typing`**: keeps the existing per-socket in-memory throttle (`TYPING_THROTTLE_MS`). It is ephemeral and per-connection, so a Redis round trip per keystroke isn't worth it.
- *Test:* new `backend/test-client/load.js` (based on `test-client/client.js`) with `--spam` sends 30 messages in 1s. About 10 are acked `ok`, and the rest return `ok:false` with `retryAfterMs`.

**Step A5: Frontend touches**
- `utils/errors.js`: no change is needed, because the 429 body uses the `{ error }` shape.
- `SocketContext.jsx`: on `connect_error` with the message `'Too many connections'`, log it and let the built-in backoff retry.
- `MessageThread.jsx`: the reply path already shows `res.error`, and normal sends already mark the bubble `failed`. Optionally, show "Slow down, try again in Ns" when `res.retryAfterMs` is present.

### Files
- **New:** `backend/src/redis.js`, `backend/src/middleware/rateLimit.js`, `backend/src/ratelimit/tokenBucket.js`, `backend/test-client/load.js`
- **Modified:** `backend/package.json`, `backend/src/index.js`, `backend/src/sockets/index.js`, `backend/src/routes/auth.js`, `backend/src/routes/conversations.js`, `backend/src/routes/users.js`, `frontend/src/context/SocketContext.jsx`

### Done when
- [ ] Brute-forcing login gets a 429 with `Retry-After`.
- [ ] Spamming `send_message` gets `ok:false` after about 10 messages, and sending works again after a few seconds.
- [ ] `docker exec -it wisper-redis redis-cli` lets you see the `rl:*` keys and their TTLs with `KEYS *` and `TTL <key>`.
- [ ] Normal chatting in the browser is unaffected.

### Concepts to write up (in `Scaling_Concepts.md`)
Fixed window vs sliding window vs token bucket; why rate-limit state must be shared (Redis); why Lua scripts make it atomic; choosing a key (IP vs user vs IP+email).

---

## Phase 9B: Shared State (multi-instance ready)

**Goal:** make the code correct when more than one backend process is running. You test this **without** a load balancer, by running 2 instances on different ports and pointing two browsers at different ports.

### Steps (in order)

**Step B1: Instance identity**
- New `backend/src/instance.js`: `INSTANCE_ID = process.env.INSTANCE_ID || os.hostname() + ':' + PORT`.
- Middleware in `index.js` sets an `X-Instance-Id` header on every response. Use it in logs too.

**Step B2: Socket.io Redis adapter**
- `npm install @socket.io/redis-adapter`.
- `redis.js` exports `createPubSub()`, which returns `[pub, sub]` duplicates.
- `index.js`: `io.adapter(createAdapter(pub, sub))`, so every `io.to(room).emit` now fans out through Redis pub/sub to all instances. No changes are needed at the emit call sites in `sockets/index.js` or `routes/conversations.js` (which uses `req.app.get('io')`).
- *Test:* with user A on :5000 and user B on :5001, messages, typing, delivered ✓✓ and read receipts all work both ways.

**Step B3: Move presence to Redis**
Rewrite `backend/src/sockets/presence.js` with the **same exported API**, now async: `add`, `remove`, `isOnline`, `onlineAmong`.

Keys:
- `presence:sockets:<userId>` is a SET of `<instanceId>|<socketId>`.
- `presence:online` is a SET of online userIds.
- `presence:instance:<instanceId>` is a SET of `userId|socketId` owned by that instance (used for cleanup).
- `presence:alive:<instanceId>` is a heartbeat string with a 30s TTL, refreshed every 10s.

Atomicity: `add` and `remove` are small **Lua scripts** (`redis.defineCommand`), so the 0→1 and 1→0 transitions are race-free even when two tabs connect to different instances at the same moment. They return `1` only on a transition, which is the same contract as today.

`onlineAmong(ids)` uses one `SMISMEMBER presence:online ...ids` call.

Changes in `backend/src/sockets/index.js`:
- `const cameOnline = await presence.add(...)`. The `disconnecting` and `disconnect` listeners must still be registered **before** this first await, per the existing comment, so register them first and then await.
- In `disconnecting`, capture the `conversation:*` room list synchronously, then `await presence.remove(...)` and emit to the captured rooms.
- `presence_snapshot` awaits `presence.onlineAmong(...)`.

*Test:* the same user opens a tab on :5000 and another on :5001. Closing one leaves them online. Closing both shows them offline to the peer.

**Step B4: Crash cleanup (sweeper)**
- When an instance dies without running its disconnect handlers, every surviving instance runs a sweeper every 15s. It reads the known instances and, for any instance whose `presence:alive:*` key has expired, calls `remove` for each member in `presence:instance:<deadId>`.
- For users that go offline this way, it emits `user_offline` to their conversation rooms (from `conversation_participants`) and writes `last_seen_at`. This reuses the same logic as the `disconnect` path.
- *Test:* kill the :5001 process with Ctrl+C twice or Task Manager. Within about 30s, its users show offline on :5000.

**Step B5: Health check + graceful shutdown**
- `GET /health`: pings MySQL and Redis and returns `{ status, instanceId }` (503 if either fails).
- On `SIGTERM`/`SIGINT`: stop accepting connections, call `io.close()` (clients auto-reconnect and rejoin rooms via the existing on-connect logic), remove this instance's presence entries, then `redis.quit()` and `pool.end()`.

### How to run two instances locally
- Terminal 1: `npm run dev` (PORT=5000 from `.env`).
- Terminal 2 (PowerShell): `$env:PORT=5001; $env:INSTANCE_ID='b'; npm run dev`.
- For the frontend, run a second Vite dev server with `VITE_API_URL=http://localhost:5001`, or use `test-client/client.js` pointed at :5001.

### Files
- **New:** `backend/src/instance.js`
- **Modified:** `backend/package.json`, `backend/src/redis.js`, `backend/src/index.js`, `backend/src/sockets/presence.js`, `backend/src/sockets/index.js`

### Done when
- [ ] Two users on two different instances can chat, and typing, delivered and read receipts all show up.
- [ ] Presence dots are correct across instances, including multi-tab.
- [ ] Killing one instance clears its users' presence within about 30s.
- [ ] `curl localhost:5000/health` and `curl localhost:5001/health` return their own `instanceId`.
- [ ] `redis-cli SMEMBERS presence:online` matches who is actually online.

### Concepts to write up
Why in-memory state breaks with multiple instances; pub/sub fan-out via the Redis adapter; presence as distributed state with heartbeats and TTLs; race conditions and atomic transitions; graceful shutdown.

---

## Phase 9C: Load Balancer + Docker

**Goal:** put Nginx in front of 3 instances so clients only ever talk to one address (`:8080`), add edge rate limiting, and package everything with Docker Compose.

### Steps (in order)

**Step C1: Dockerize the backend**
- New `backend/Dockerfile`: `node:22-slim` (Debian, so `bcrypt` native prebuilds work), `npm ci --omit=dev`, `CMD ["node","src/index.js"]`.
- New `backend/.dockerignore` (node_modules, .env).
- MySQL note: the host MySQL user must accept connections from Docker (`'user'@'%'`, or `172.%`).

**Step C2: Docker Compose**
- New root `docker-compose.yml`:
  - `redis:7-alpine` with a healthcheck (`redis-cli ping`). It replaces the manual `docker run` from 9A.
  - `backend1/2/3` share one YAML anchor: `env_file: backend/.env`, overrides `INSTANCE_ID=backendN`, `REDIS_URL=redis://redis:6379`, `DB_HOST=host.docker.internal`, `extra_hosts: host.docker.internal:host-gateway`, `depends_on: redis (healthy)`, and a healthcheck on `/health`.
- *Test:* run `docker compose up --build redis backend1`, then `curl localhost:5000/health` (publish the port temporarily).

**Step C3: Nginx load balancer**
New `infra/nginx/nginx.conf`:
- `upstream wisper_backend { least_conn; server backend1:5000 max_fails=3 fail_timeout=10s; ... backend2, backend3 }`
- WebSocket proxying: `proxy_http_version 1.1`, `Upgrade $http_upgrade`, `Connection "upgrade"`, `proxy_read_timeout 75s` (above Socket.io's 25s ping).
- `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto` headers.
- `add_header X-Upstream $upstream_addr` so you can watch requests move between instances.
- Add an `nginx:1.27-alpine` service to compose that mounts the config and publishes `8080:80`.
- Backend: `app.set('trust proxy', 1)` in `index.js`, so `req.ip` (used by the 9A limiters) is the real client IP and not Nginx's IP.

**Step C4: WebSocket-only client (no sticky sessions)**
- Socket.io's HTTP long-polling transport needs every request of a session to hit the same instance. Instead of `ip_hash` (on localhost every client has the same IP, so everything would land on one instance), the client goes **WebSocket-only**.
- `frontend/src/context/SocketContext.jsx`: `io(API_BASE_URL, { auth: { token }, transports: ['websocket'] })`.
- `frontend/.env.local`: `VITE_API_URL=http://localhost:8080` (`api/client.js` already reads it).

**Step C5: Edge rate limiting in Nginx**
- `limit_req_zone $binary_remote_addr zone=api:10m rate=20r/s;` with `limit_req zone=api burst=40 nodelay;` on `/api/`, returning 429.
- `limit_conn` per IP on `/socket.io/`.
- This is the coarse first layer. The 9A app limits stay as the fine-grained per-user layer.

**Step C6: Docs**
- Finish `Scaling_Concepts.md`.
- `PHASE_EXE.md`: add "Phase 9: Rate Limiting and Horizontal Scale" and point the 8.4 Redis line to it.
- `README.md`: add a "Run the scaled stack" section (`docker compose up --build`, then the frontend on `:5173` talking to `:8080`).

### Files
- **New:** `backend/Dockerfile`, `backend/.dockerignore`, `docker-compose.yml`, `infra/nginx/nginx.conf`, `frontend/.env.local`, `Scaling_Concepts.md`
- **Modified:** `backend/src/index.js`, `frontend/src/context/SocketContext.jsx`, `PHASE_EXE.md`, `README.md`

### Done when
- [ ] Running `curl -i localhost:8080/health` several times shows `X-Instance-Id` cycling between backend1, backend2 and backend3.
- [ ] Two browsers as two users land on different instances (check `docker compose logs`), and everything in chat works.
- [ ] `docker compose stop backend2`: clients reconnect to another instance within seconds, and chat continues.
- [ ] `docker compose kill backend3` (no graceful shutdown): the sweeper clears stale presence within about 30s.
- [ ] A `for` loop of 200 `curl` requests to `/api/users/search` returns 429, from Nginx first (burst) and then from the app limiter.
- [ ] `npm run lint` passes in `frontend/`.

### Concepts to write up
L4 vs L7 load balancing; round-robin vs least_conn vs ip_hash; sticky sessions and Socket.io transports; edge vs app vs event rate limits (defense in depth); health checks and failover; what would come next (Redis Sentinel/Cluster, Kubernetes, MySQL read replicas).
