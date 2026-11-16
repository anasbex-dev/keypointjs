# Rate Limiting

KeyPointJS includes a `RateLimiter` plugin at `keypointjs/plugins/ratelimit`. It supports fixed window, sliding window log, sliding window counter, token bucket, and leaky bucket algorithms. It is separate from `BuiltInRules.rateLimitRule()`, which remains an independent policy-engine rule with its own counters.

## Quick start

The built-in plugin is enabled by default. For authenticated requests it uses the keypoint's `rateLimit.requests` and `rateLimit.window` values (`window` is in seconds). When a request has no keypoint, the fallback uses the validated request IP and the configured plugin `max` and `window` (milliseconds).

```js
import { KeypointJS } from 'keypointjs';

const app = new KeypointJS({
  enableRateLimiter: true,
  rateLimitMax: 120,
  rateLimitWindow: 60_000,
  rateLimiter: {
    algorithm: 'sliding-window-counter',
    keyHashSecret: process.env.RATE_LIMIT_KEY_SECRET
  }
});
```

The plugin attaches `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `RateLimit-Policy` response headers. Rejected requests use HTTP 429 and include `Retry-After`. `onLimitReached` can produce a framework response; otherwise `responseBody` optionally overrides the default error body.

## Installation

The limiter uses Node.js built-ins and adds no package dependency. Redis support accepts a client supplied by the application, so install and configure that Redis client separately if needed.

## Algorithms and configuration

The plugin constructor accepts `limit`/`max`, `windowMs`/`window` (milliseconds), `algorithm`, `burst`, and optional policies. Defaults are a fixed window, limit 100, 60,000 ms, a 100,000-entry memory store, a cleanup interval of 60,000 ms, batches of 256 entries, and identity length up to 512 characters. In-memory time uses a monotonic clock; Redis uses Redis server time. Sliding-window logs are capped at 10,000 timestamps per identity by default. Integer settings must be positive safe integers.

```js
import { RateLimiter } from 'keypointjs/plugins/ratelimit';

const limiter = new RateLimiter({
  algorithm: 'token-bucket',
  limit: 30,                 // refill rate over windowMs
  windowMs: 60_000,
  burst: 10,                 // bucket capacity
  keyBy: 'ip',
  policies: [
    {
      id: 'writes',
      algorithm: 'sliding-window-log',
      keyBy: 'keypoint',
      limit: 20,
      windowMs: 60_000,
      match: { method: ['POST', 'PUT', 'PATCH'], path: '/api/*' }
    }
  ]
});
```

Policies support `global`, `ip`, `user`, `keypoint`, `apiKey`, `route`, and `custom` identities. `match` supports exact paths and a trailing `/*` prefix, plus one or more HTTP methods. `when`, `exempt`, `keyGenerator`, and dynamic `limit`, `windowMs`, and `burst` callbacks may be async. A top-level `keyGenerator(context, policy)` overrides the built-in identity selection. User identities come from `context.user.id`, `context.auth.userId`, or keypoint metadata `userId`; identity is never read from arbitrary headers.

Each matching policy consumes its own quota. Policies are evaluated by descending numeric priority; for requests with a keypoint, its `rateLimit` quota is also checked. If an earlier policy consumes a hit and a later policy rejects, the earlier hit remains consumed.

## Identity and proxy handling

Rate-limit keys are HMAC-SHA-256 hashes of the namespace, policy ID, and identity. The default in-memory configuration uses a per-instance random secret. If counters must be shared by workers or hosts, supply a consistent `keyHashSecret` of at least 16 characters to every instance. A Redis-backed limiter requires this shared secret. Do not reuse a public or low-entropy value.

IP quotas use the framework's `context.ip`, which is resolved by its HTTP engine using `trustedProxies`. Configure `trustedProxies` only with addresses or CIDR ranges belonging to your real proxy infrastructure. The limiter does not parse `X-Forwarded-For` itself. Without a trusted proxy, spoofed forwarding headers do not change the identity.

## Stores and failure behavior

The default `MemoryStore` is local to one process, bounded by `maxKeys`, and periodically removes expired entries in bounded batches. It is not shared across Node.js workers or durable. On capacity exhaustion, the store reports an error instead of growing without limit. The limits reduce resource use but are not complete denial-of-service protection.

To use Redis, pass an already configured node-redis v4 or ioredis compatible client. KeyPointJS does not add a Redis client dependency or manage its connection unless `redisOptions.closeClient` is explicitly `true`.

```js
import { RateLimiter } from 'keypointjs/plugins/ratelimit';

const limiter = new RateLimiter({
  redis: redisClient,
  redisOptions: { prefix: 'service:rate:', evalStyle: 'node-redis' },
  keyHashSecret: process.env.RATE_LIMIT_KEY_SECRET,
  failureMode: 'fail-closed',
  timeoutMs: 500
});
```

The Redis adapter performs the counter update in one Lua call and uses Redis server time. It supports node-redis v4 (`eval(script, { keys, arguments })`) and ioredis (`eval(script, numberOfKeys, ...args)`). The caller owns the client by default and should close the limiter on shutdown. A custom store can be supplied as `{ consume(request) }`; it receives an opaque hashed key and should implement an atomic consume operation. For a custom distributed store, use the same shared `keyHashSecret` across instances.

`failureMode` is `fail-closed` by default: a store failure or timeout produces HTTP 503. Set `fail-open` to allow the request if that tradeoff is appropriate. `timeoutMs` bounds the wait for an adapter response; it cannot cancel an operation already running inside a third-party client.

```js
await limiter.shutdown(); // closes owned memory state; Redis client stays open by default
```

When the framework shuts down, it invokes plugin shutdown. `cleanup()` also disposes the owned memory store when a plugin is unregistered. Caller-provided custom stores remain caller-owned.

## Separate policy-engine rule

`BuiltInRules.rateLimitRule(limit = 100, windowSeconds = 60)` remains independent and is registered by KeyPointJS. It uses a closure-local memory map and should not be treated as a substitute for the plugin's configurable stores or algorithms. If both mechanisms are enabled, a request must satisfy both limits.

## Verification and limits

Run the deterministic suite with `node --test test/rate-limiter.test.js` and all tests with `npm run test:all`. Redis adapter unit tests use a mock client. A real Redis server is needed to verify script execution and cross-process behavior; mock tests do not establish deployment reliability or throughput. `node benchmarks/rate-limiter.js` prints an informational in-process benchmark for the current machine only. Load test your own proxy topology, store, policies, and deployment before using rate limits as an abuse-control boundary.

## Migration from the previous plugin

Existing `new RateLimiter({ window, max })` construction remains valid; `window` stays in milliseconds. Authenticated limits now honor both `keypoint.rateLimit.requests` and its `window` in seconds. Unauthenticated requests use the configured `max` and `window` with their trusted request IP. The old `.limits` property remains available for in-process callers, but its values are now internal store state records; do not mutate it. Limit violations now use a framework 429 response with quota headers instead of a generic error. Applications that relied on generic 500 behavior should update their error handling. The separate `BuiltInRules.rateLimitRule()` remains unchanged and still has its own quota; disable either mechanism explicitly if only one policy is intended.

## API reference

- `new RateLimiter(options)` validates settings and creates an owned `MemoryStore`, or uses the supplied `store`/`redis` adapter.
- `await limiter.process(context, next)` is the plugin middleware entry point. A rejected request stops before `next`.
- `limiter.cleanup()` synchronously stops plugin-owned resources when the plugin manager unregisters it. `await limiter.shutdown()` disposes the owned store.
- `new MemoryStore(options)` and `new RedisStore(client, options)` expose `consume({ key, algorithm, limit, windowMs, burst, nowMs })` and `close()`; stores return `{ allowed, limit, remaining, retryAfterMs, resetAt, algorithm }` (Redis additionally reports `resetAfterMs`).
- A custom `store.consume(request)` must atomically account for one request and return the same result fields. Its `key` is opaque and already HMAC hashed.
- `onLimitReached(context, result, policy)` may return `{ status, headers, body }`. If it returns `undefined`, the plugin emits its standard `RateLimitExceededError` and KeyPointJS converts that to a 429.
- The adapter types, errors, and algorithm functions are exported from `keypointjs/plugins/ratelimit`.
