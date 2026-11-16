import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RateLimiter, MemoryStore, RedisStore, RateLimitExceededError } from '../src/plugins/RateLimiter.js';
import { Context } from '../src/core/Context.js';
import { consumeFixedWindow } from '../src/plugins/rate-limiter/algorithms/fixed-window.js';
import { consumeSlidingWindowLog } from '../src/plugins/rate-limiter/algorithms/sliding-window-log.js';
import { consumeSlidingWindowCounter } from '../src/plugins/rate-limiter/algorithms/sliding-window-counter.js';
import { consumeTokenBucket } from '../src/plugins/rate-limiter/algorithms/token-bucket.js';
import { consumeLeakyBucket } from '../src/plugins/rate-limiter/algorithms/leaky-bucket.js';
import { REDIS_CONSUME_SCRIPT } from '../src/plugins/rate-limiter/redis-script.js';

const cfg = { limit: 2, windowMs: 1000, burst: 2 };
function context({ ip = '192.0.2.10', method = 'GET', path = '/' } = {}) {
  const value = new Context({ method, url: new URL(`http://localhost${path}`), headers: {}, ip });
  value.request.ip = ip;
  return value;
}

describe('rate limiter algorithms', () => {
  it('enforces fixed-window boundaries', () => {
    let result = consumeFixedWindow(undefined, cfg, 1000);
    result = consumeFixedWindow(result.state, cfg, 1999);
    assert.equal(result.allowed, true);
    result = consumeFixedWindow(result.state, cfg, 1999);
    assert.equal(result.allowed, false);
    assert.equal(result.retryAfterMs, 1);
    assert.equal(consumeFixedWindow(result.state, cfg, 2000).allowed, true);
  });

  it('expires exact sliding-window hits at the boundary', () => {
    let result = consumeSlidingWindowLog(undefined, cfg, 10);
    result = consumeSlidingWindowLog(result.state, cfg, 20);
    assert.equal(consumeSlidingWindowLog(result.state, cfg, 1009).allowed, false);
    assert.equal(consumeSlidingWindowLog(result.state, cfg, 1010).allowed, true);
  });

  it('weights the previous window in the sliding counter', () => {
    let result = consumeSlidingWindowCounter(undefined, cfg, 100);
    result = consumeSlidingWindowCounter(result.state, cfg, 200);
    result = consumeSlidingWindowCounter(result.state, cfg, 1050);
    assert.equal(result.allowed, true);
    result = consumeSlidingWindowCounter(result.state, cfg, 1050);
    assert.equal(result.allowed, false);

    const densePrevious = consumeSlidingWindowCounter({ windowStart: 1000, previousCount: 200, currentCount: 2 }, cfg, 1999);
    assert.equal(densePrevious.allowed, false);
    assert.equal(densePrevious.retryAfterMs, 2);
    assert.equal(consumeSlidingWindowCounter(densePrevious.state, cfg, 2001).allowed, true);
  });

  it('refills token bucket and drains leaky bucket', () => {
    let token = consumeTokenBucket(undefined, cfg, 0);
    token = consumeTokenBucket(token.state, cfg, 0);
    assert.equal(consumeTokenBucket(token.state, cfg, 0).allowed, false);
    assert.equal(consumeTokenBucket(token.state, cfg, 500).allowed, true);

    let leaky = consumeLeakyBucket(undefined, cfg, 0);
    leaky = consumeLeakyBucket(leaky.state, cfg, 0);
    assert.equal(consumeLeakyBucket(leaky.state, cfg, 0).allowed, false);
    assert.equal(consumeLeakyBucket(leaky.state, cfg, 500).allowed, true);
  });
});

describe('MemoryStore', () => {
  it('atomically enforces a concurrent fixed-window limit and keeps entries bounded', async () => {
    const store = new MemoryStore({ autoCleanup: false, maxEntries: 3 });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consume({ key: 'one', algorithm: 'fixed-window', ...cfg, nowMs: 100 })));
    assert.equal(results.filter((result) => result.allowed).length, 2);
    assert.equal(store.entries.size, 1);
    await store.close();
    assert.equal(store.entries.size, 0);
    await assert.rejects(store.consume({ key: 'one', algorithm: 'fixed-window', ...cfg, nowMs: 100 }), /closed/);
  });

  it('rejects capacity exhaustion instead of growing without bound', async () => {
    const store = new MemoryStore({ autoCleanup: false, maxEntries: 1 });
    await store.consume({ key: 'one', algorithm: 'fixed-window', ...cfg, nowMs: 1 });
    await assert.rejects(store.consume({ key: 'two', algorithm: 'fixed-window', ...cfg, nowMs: 1 }), { code: 'RATE_LIMIT_STORE_CAPACITY' });
    await store.close();
  });

  it('expires old buckets through bounded cleanup batches', async () => {
    const store = new MemoryStore({ autoCleanup: false, cleanupBatchSize: 2, maxEntries: 10 });
    for (let index = 0; index < 4; index++) {
      await store.consume({ key: String(index), algorithm: 'fixed-window', limit: 1, windowMs: 10, nowMs: 0 });
    }
    assert.equal(store.cleanup(2, 20), 2);
    assert.equal(store.cleanup(2, 20), 2);
    assert.equal(store.entries.size, 0);
    await store.close();
  });
});

describe('RateLimiter plugin', () => {
  it('exports the plugin and adapters from the declared package subpath', async () => {
    const exports = await import('keypointjs/plugins/ratelimit');
    assert.equal(typeof exports.RateLimiter, 'function');
    assert.equal(typeof exports.MemoryStore, 'function');
    assert.equal(typeof exports.RedisStore, 'function');
    assert.ok(exports.algorithmNames.includes('token-bucket'));
  });

  it('validates top-level identity strategy and incompatible store selection', () => {
    assert.throws(() => new RateLimiter({ keyBy: 'header' }), /Unsupported rate limit keyBy/);
    assert.throws(() => new RateLimiter({ store: { consume() {} }, redis: { eval() {} }, keyHashSecret: 'a-secret-that-is-long-enough' }), /either a custom store or Redis/);
  });

  it('emits standard quota headers and rejects over-limit requests with HTTP 429', async () => {
    let now = 1000;
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, clock: () => now, keyHashSecret: 'a-secret-that-is-long-enough' });
    const first = context();
    await limiter.process(first, async (ctx) => { ctx.response.body = 'ok'; return ctx; });
    assert.equal(first.response.headers['RateLimit-Limit'], '1');
    assert.equal(first.response.headers['RateLimit-Remaining'], '0');
    const second = context();
    await assert.rejects(limiter.process(second, async () => assert.fail('downstream must not run')), (error) => {
      assert.ok(error instanceof RateLimitExceededError);
      assert.equal(error.code, 429);
      assert.equal(error.headers['Retry-After'], '1');
      return true;
    });
    now += 1000;
    assert.equal((await limiter.store.consume({ key: 'probe', algorithm: 'fixed-window', limit: 1, windowMs: 1000, nowMs: now })).allowed, true);
    await limiter.shutdown();
  });

  it('keys requests by validated IP and ignores forwarded headers supplied in headers', async () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 10000, keyBy: 'ip', keyHashSecret: 'a-secret-that-is-long-enough' });
    const first = context({ ip: '192.0.2.1' });
    first.request.headers['x-forwarded-for'] = '198.51.100.5';
    await limiter.process(first, async (ctx) => ctx);
    await assert.rejects(limiter.process(context({ ip: '192.0.2.1' }), async (ctx) => ctx), { code: 429 });
    await limiter.process(context({ ip: '192.0.2.2' }), async (ctx) => ctx);
    await assert.rejects(limiter.process(context({ ip: 'not-an-ip' }), async (ctx) => ctx), /safe identity/);
    await limiter.shutdown();

    const ipv6 = new RateLimiter({ limit: 1, keyBy: 'ip', keyHashSecret: 'a-secret-that-is-long-enough' });
    await ipv6.process(context({ ip: '2001:0db8:0:0:0:0:0:1' }), async (ctx) => ctx);
    await assert.rejects(ipv6.process(context({ ip: '2001:db8::1' }), async (ctx) => ctx), { code: 429 });
    await ipv6.process(context({ ip: '2001:db8::2' }), async (ctx) => ctx);
    await ipv6.shutdown();
  });

  it('applies matching policy limits and supports dynamic policy callbacks', async () => {
    const limiter = new RateLimiter({
      keyHashSecret: 'a-secret-that-is-long-enough',
      policies: [{ id: 'write-api', keyBy: 'ip', limit: (ctx) => ctx.request.method === 'POST' ? 1 : 2,
        windowMs: 5000, match: { method: 'POST', path: '/api/*' } }]
    });
    await limiter.process(context({ method: 'POST', path: '/api/items' }), async (ctx) => ctx);
    await assert.rejects(limiter.process(context({ method: 'POST', path: '/api/items' }), async (ctx) => ctx), { code: 429 });
    await limiter.process(context({ method: 'GET', path: '/api/items' }), async (ctx) => ctx);
    await limiter.shutdown();
  });

  it('supports exemptions, custom key generators, and independently scoped policies', async () => {
    let generated = 0;
    const limiter = new RateLimiter({
      keyHashSecret: 'a-secret-that-is-long-enough',
      policies: [{ id: 'custom-route', keyBy: 'custom', limit: 1, windowMs: 5000,
        keyGenerator: async () => { generated++; return 'tenant-one'; },
        match: { path: '/custom' } }]
    });
    await limiter.process(context({ path: '/other' }), async (ctx) => ctx);
    await limiter.process(context({ path: '/custom' }), async (ctx) => ctx);
    await assert.rejects(limiter.process(context({ path: '/custom' }), async (ctx) => ctx), { code: 429 });
    assert.equal(generated, 2);
    const exempt = new RateLimiter({ limit: 1, exempt: async () => true });
    await exempt.process(context(), async (ctx) => ctx);
    await exempt.process(context(), async (ctx) => ctx);
    await exempt.shutdown();
    await limiter.shutdown();
  });

  it('allows a custom limit handler to return a framework response without calling next', async () => {
    let downstreamCalled = false;
    const limiter = new RateLimiter({
      limit: 1,
      onLimitReached: async () => ({ status: 429, headers: { 'X-Limit-Reason': 'custom' }, body: { message: 'wait' } })
    });
    await limiter.process(context(), async (ctx) => ctx);
    const responseContext = await limiter.process(context(), async () => { downstreamCalled = true; });
    assert.equal(downstreamCalled, false);
    assert.equal(responseContext.response.status, 429);
    assert.equal(responseContext.response.headers['X-Limit-Reason'], 'custom');
    assert.deepEqual(responseContext.response.body, { message: 'wait' });
    await limiter.shutdown();
  });

  it('applies the keypoint-specific limit and isolates policies by keypoint ID', async () => {
    const limiter = new RateLimiter({ keyHashSecret: 'a-secret-that-is-long-enough' });
    const makeKeypointContext = (keyId, requests) => {
      const ctx = context();
      ctx.keypoint = { keyId, rateLimit: { requests, window: 10 } };
      return ctx;
    };
    await limiter.process(makeKeypointContext('key-one', 1), async (ctx) => ctx);
    await assert.rejects(limiter.process(makeKeypointContext('key-one', 1), async (ctx) => ctx), { code: 429 });
    await limiter.process(makeKeypointContext('key-two', 1), async (ctx) => ctx);
    await limiter.shutdown();
  });

  it('supports custom stores, failure modes, timeouts, response customization, and cleanup', async () => {
    let calls = 0;
    const custom = { consume: async () => { calls++; return { allowed: true, limit: 1, remaining: 0, retryAfterMs: 0, resetAt: 2000 }; } };
    const limiter = new RateLimiter({ store: custom, limit: 1, keyHashSecret: 'a-secret-that-is-long-enough' });
    await limiter.process(context(), async (ctx) => ctx);
    assert.equal(calls, 1);
    await limiter.shutdown();
    assert.equal(limiter.disposed, true);

    const failing = { consume: async () => { throw new Error('offline'); } };
    const failOpen = new RateLimiter({ store: failing, failureMode: 'fail-open', limit: 1 });
    let passed = false;
    await failOpen.process(context(), async (ctx) => { passed = true; return ctx; });
    assert.equal(passed, true);
    await assert.rejects(new RateLimiter({ store: failing, failureMode: 'fail-closed', limit: 1 }).process(context(), async () => {}), { code: 503 });

    const slow = new RateLimiter({ store: { consume: () => new Promise(() => {}) }, timeoutMs: 5, limit: 1 });
    await assert.rejects(slow.process(context(), async () => {}), { code: 503 });
  });

  it('returns configured 429 response body through KeyPointJS error handling', async () => {
    const { KeypointJS } = await import('../src/keypointJS.js');
    const api = new KeypointJS({
      requireKeypoint: false, enableAuditLog: false, rateLimitMax: 1,
      rateLimiter: { windowMs: 60_000, keyBy: 'ip', responseBody: { error: 'Slow down' }, keyHashSecret: 'a-secret-that-is-long-enough' }
    });
    api.get('/limited', (ctx) => ctx.json({ ok: true }));
    const makeRequest = () => {
      const request = new EventEmitter();
      request.method = 'GET';
      request.url = '/limited';
      request.headers = { host: 'localhost' };
      request.socket = { remoteAddress: '127.0.0.1' };
      request.connection = request.socket;
      return request;
    };
    const send = async () => {
      const request = makeRequest();
      const pending = api.handleRequest(request, {});
      request.emit('end');
      return pending;
    };
    assert.equal((await send()).status, 200);
    const limited = await send();
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: 'Slow down' });
    assert.ok(limited.headers['Retry-After']);
    await api.shutdown();
  });

  it('clears owned stores during plugin cleanup and rejects invalid Redis configuration', async () => {
    const limiter = new RateLimiter({ cleanupIntervalMs: 60_000 });
    assert.ok(limiter.store.timer);
    limiter.cleanup();
    assert.equal(limiter.store.timer, null);
    assert.throws(() => new RateLimiter({ redis: { eval() {} } }), /keyHashSecret/);
    await assert.rejects(new RedisStore({ eval() {} }).consume({ key: 'k', algorithm: 'fake', limit: 1, windowMs: 1 }), /Unsupported/);
  });
});

describe('RedisStore adapter contract', () => {
  it('uses the atomic Lua script through node-redis and parses its result', async () => {
    let received;
    const store = new RedisStore({ eval: async (...args) => { received = args; return [1, 3, 0, 123456, 456]; } });
    const result = await store.consume({ key: 'opaque', algorithm: 'fixed-window', limit: 4, windowMs: 1000, burst: 4 });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3);
    assert.equal(received[0], REDIS_CONSUME_SCRIPT);
    assert.deepEqual(received[1].keys, ['keypointjs:ratelimit:opaque']);
    await store.close();
  });

  it('supports ioredis eval calling convention and rejects malformed replies', async () => {
    let received;
    const store = new RedisStore({ status: 'ready', eval: async (...args) => { received = args; return [0, 0, 10, 20, 10]; } });
    assert.equal((await store.consume({ key: 'opaque', algorithm: 'fixed-window', limit: 1, windowMs: 1000 })).allowed, false);
    assert.equal(received[1], 1);
    const broken = new RedisStore({ eval: async () => ['not a number'] });
    await assert.rejects(broken.consume({ key: 'key', algorithm: 'fixed-window', limit: 1, windowMs: 1000 }), /invalid result/);
  });

  it('enforces a quota against a real Redis server when explicitly configured', async (t) => {
    if (!process.env.REDIS_URL) {
      t.skip('Set REDIS_URL and install a compatible redis client to run the Redis integration test.');
      return;
    }
    let redisModule;
    try { redisModule = await import('redis'); }
    catch { t.skip('The optional redis client package is not installed.'); return; }
    const client = redisModule.createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const limiter = new RateLimiter({
      redis: client,
      redisOptions: { prefix: `keypointjs:test:${Date.now()}:` },
      keyHashSecret: 'shared-integration-secret-value',
      limit: 1,
      windowMs: 60_000,
      keyBy: 'ip'
    });
    try {
      await limiter.process(context(), async (ctx) => ctx);
      await assert.rejects(limiter.process(context(), async (ctx) => ctx), { code: 429 });
    } finally {
      await limiter.shutdown();
      await client.quit();
    }
  });
});
