# Auth Concepts — Quick Reference

## SHA-256
General-purpose cryptographic hash. Fixed 256-bit output, deterministic, one-way.
**Fast by design** — good for integrity checks (file checksums, signatures). Too fast to be safe for hashing passwords alone: a GPU can compute billions of SHA-256 hashes/sec, making brute-force feasible.

## Bcrypt
Purpose-built for password hashing. **Deliberately slow** via a tunable cost factor (Wisper uses `10` → 2¹⁰ rounds).
- Auto-generates a unique random salt per password — two identical passwords produce different hashes.
- Slowness is the security feature: irrelevant for one real login, devastating for an attacker trying billions of guesses.
- Never use for anything except password storage — too slow for high-frequency operations like token verification.

## HS256 (HMAC-SHA256)
Not the same as plain SHA-256. HMAC = a keyed hash — SHA-256 combined with a secret key.
```
signature = HMAC-SHA256(header + "." + payload, SECRET)
```
Anyone can recompute the hash of the header+payload (it's public). Only someone with `SECRET` can produce a signature that matches — this is what prevents token forgery.

## JWT (JSON Web Token)
Three parts, dot-separated: `header.payload.signature`
- **Header + payload** — base64-encoded JSON. Readable by anyone. **Not encrypted.**
- **Signature** — HS256 output over header+payload, using the server's secret. Proves the token wasn't altered; doesn't hide its contents.
- Workflow: login succeeds → server signs a JWT containing `{ userId }` → client stores/sends it → server re-verifies the signature on every protected request, never re-checking the database for identity.

## How they fit together in Wisper
| Step | Mechanism | Purpose |
|---|---|---|
| Signup | bcrypt | Hash password before storing — original password never touches the DB |
| Login | bcrypt.compare() | Verify submitted password against stored hash |
| Login success | HS256 | Sign a JWT proving identity for future requests |
| Every protected request | HS256 | Re-verify the JWT signature — no DB lookup needed |

**Key distinction to remember:** bcrypt protects data *at rest* (the password in your DB). HS256/JWT protects data *in transit and reuse* (proving a request is really from the logged-in user) — they solve different problems and aren't interchangeable.