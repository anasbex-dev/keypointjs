import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeRateLimiterOptions, normalizeResolvedBurst, normalizeResolvedLimit, normalizeResolvedWindow } from './rate-limiter/config.js';
import { MemoryStore } from './rate-limiter/MemoryStore.js';
import { RedisStore } from './rate-limiter/RedisStore.js';
import { RateLimitExceededError, RateLimiterStorageError } from './rate-limiter/errors.js';

function routeMatches(paths, pathname) {
  return !paths || paths.some((path) => path.endsWith('/*')
    ? pathname.startsWith(path.slice(0, -1))
    : pathname === path);
}

function getPath(context) {
  const url = context.request?.url;
  if (url instanceof URL) return url.pathname;
  if (typeof url === 'string') {
    try { return new URL(url, 'http://localhost').pathname; } catch { /* use fallback */ }
  }
  return context.path || '/';
}

function normalizeIdentity(value, maxLength) {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  const identity = String(value).trim();
  if (!identity || identity.length > maxLength) return null;
  return identity;
}

function normalizeIpIdentity(value, maxLength) {
  const identity = normalizeIdentity(value, maxLength);
  if (!identity) return null;
  const ip = identity.replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  try { return new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase(); }
  catch { return null; }
}

export class RateLimiter {
  constructor(options = {}) {
    this.config = normalizeRateLimiterOptions(options);
    this.options = this.config;
    this.window = this.config.windowMs;
    this.disposed = false;
    this.ownsStore = !this.config.store;
    if (this.config.store) this.store = this.config.store;
    else if (this.config.redis) {
      if (!this.config.keyHashSecret || this.config.keyHashSecret.length < 16) {
        throw new TypeError('Redis rate limiting requires keyHashSecret with at least 16 characters');
      }
      this.store = new RedisStore(this.config.redis, { maxLogEntries: this.config.maxLogEntries, ...(this.config.redisOptions || {}) });
    } else {
      this.store = new MemoryStore({
        maxEntries: this.config.maxKeys,
        cleanupIntervalMs: this.config.cleanupIntervalMs,
        cleanupBatchSize: this.config.cleanupBatchSize,
        maxLogEntries: this.config.maxLogEntries,
        clock: this.config.clock
      });
    }
    this.keyHashSecret = this.config.keyHashSecret || randomBytes(32);
    // Compatibility for callers that inspected the old in-memory counter map.
    this.limits = this.store.entries || new Map();
  }

  async process(context, next) {
    if (this.disposed) throw new Error('RateLimiter is closed');
    const nowMs = this.#now();
    if (await this.#isExempt(this.config.exempt, context)) return next(context);

    const policies = this.#resolvePolicies(context);
    let effectiveHeaders = {};
    for (const policy of policies) {
      if (!(await this.#matches(policy, context))) continue;
      const result = await this.#consumePolicy(policy, context, nowMs);
      if (!result) continue;
      const headers = this.#headers(result, nowMs);
      effectiveHeaders = { ...effectiveHeaders, ...headers };
      context.rateLimit = { ...result, policyId: policy.id };
      if (!result.allowed) {
        const retrySeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        const blockedHeaders = { ...headers, 'Retry-After': String(retrySeconds) };
        if (this.config.onLimitReached) {
          const response = await this.config.onLimitReached(context, { ...result, headers: blockedHeaders }, policy);
          if (response !== undefined) {
            if (!response || typeof response !== 'object' || !Number.isInteger(response.status)) {
              throw new TypeError('onLimitReached must return a response object with an integer status');
            }
            context.response.status = response.status;
            context.response.headers = { ...context.response.headers, ...blockedHeaders, ...(response.headers || {}) };
            context.response.body = response.body;
            return context;
          }
        }
        const body = typeof this.config.responseBody === 'function'
          ? await this.config.responseBody(context, result, policy)
          : this.config.responseBody;
        throw new RateLimitExceededError({ headers: blockedHeaders, responseBody: body });
      }
    }

    const response = await next(context);
    if (Object.keys(effectiveHeaders).length && context.response) {
      context.response.headers = { ...context.response.headers, ...effectiveHeaders };
    }
    return response;
  }

  #now() {
    const value = typeof this.config.clock === 'function' ? this.config.clock() : this.config.clock.now();
    if (!Number.isFinite(value)) throw new TypeError('RateLimiter clock must return a finite timestamp');
    return value;
  }

  #resolvePolicies(context) {
    const policies = [...this.config.policies];
    if (context.keypoint?.rateLimit) {
      const keypointWindowSeconds = context.keypoint.rateLimit.window;
      policies.unshift({
        id: 'keypoint-default', algorithm: this.config.algorithm, keyBy: 'keypoint',
        limit: context.keypoint.rateLimit.requests ?? this.config.limit,
        windowMs: Number.isFinite(keypointWindowSeconds) && keypointWindowSeconds > 0
          ? keypointWindowSeconds * 1000 : this.config.windowMs,
        burst: this.config.burst, priority: Number.MAX_SAFE_INTEGER, methods: null, paths: null,
        when: null, exempt: null, keyGenerator: null
      });
    } else if (!policies.length) {
      policies.push({
        id: 'default', algorithm: this.config.algorithm, keyBy: this.config.keyBy || 'ip',
        limit: this.config.limit, windowMs: this.config.windowMs, burst: this.config.burst,
        priority: 0, methods: null, paths: null, when: null, exempt: null, keyGenerator: this.config.keyGenerator
      });
    }
    return policies.sort((a, b) => b.priority - a.priority);
  }

  async #matches(policy, context) {
    const method = String(context.request?.method || context.method || 'GET').toUpperCase();
    if (policy.methods && !policy.methods.includes(method)) return false;
    if (!routeMatches(policy.paths, getPath(context))) return false;
    if (await this.#isExempt(policy.exempt, context)) return false;
    return !policy.when || Boolean(await policy.when(context));
  }

  async #isExempt(exempt, context) {
    return exempt ? Boolean(await exempt(context)) : false;
  }

  async #identity(policy, context) {
    if (policy.keyGenerator || this.config.keyGenerator) {
      const generator = policy.keyGenerator || this.config.keyGenerator;
      return normalizeIdentity(await generator(context, policy), this.config.maxIdentityLength);
    }
    const request = context.request || {};
    const keypoint = context.keypoint;
    switch (policy.keyBy) {
      case 'global': return 'global';
      case 'ip': {
        return normalizeIpIdentity(context.ip || request.ip, this.config.maxIdentityLength);
      }
      case 'user': return normalizeIdentity(context.user?.id ?? context.auth?.userId ?? keypoint?.metadata?.userId, this.config.maxIdentityLength);
      case 'apiKey':
      case 'keypoint': return normalizeIdentity(keypoint?.keyId, this.config.maxIdentityLength);
      case 'route': return `${request.method || context.method || 'GET'}:${getPath(context)}`;
      case 'custom': return null;
      default: return null;
    }
  }

  async #consumePolicy(policy, context, nowMs) {
    const limitValue = typeof policy.limit === 'function' ? await policy.limit(context) : policy.limit;
    const windowValue = typeof policy.windowMs === 'function' ? await policy.windowMs(context) : policy.windowMs;
    const limit = normalizeResolvedLimit(limitValue, `Rate limit policy "${policy.id}" limit`);
    const windowMs = normalizeResolvedWindow(windowValue, `Rate limit policy "${policy.id}" windowMs`);
    let burst = policy.burst ?? this.config.burst ?? limit;
    if (typeof burst === 'function') burst = await burst(context);
    burst = normalizeResolvedBurst(burst, `Rate limit policy "${policy.id}" burst`);
    if (policy.algorithm === 'sliding-window-log' && limit > this.config.maxLogEntries) {
      throw new RangeError(`Rate limit policy "${policy.id}" exceeds maxLogEntries (${this.config.maxLogEntries})`);
    }
    const identity = await this.#identity(policy, context);
    if (!identity) throw new TypeError(`Rate limit policy "${policy.id}" could not resolve a safe identity`);
    const hash = createHmac('sha256', this.keyHashSecret).update(JSON.stringify([this.config.namespace, policy.id, identity])).digest('hex');
    try {
      const result = await this.#withTimeout(this.store.consume({
        key: hash, algorithm: policy.algorithm, limit, windowMs, burst, nowMs,
        maxLogEntries: this.config.maxLogEntries
      }));
      return { ...result, limit, windowMs, policyId: policy.id };
    } catch (error) {
      if (this.config.onError) {
        try {
          await this.config.onError({ name: error?.name || 'Error', code: error?.code, message: 'Rate-limit storage operation failed' }, {
            code: error?.code, policyId: policy.id, algorithm: policy.algorithm
          });
        } catch { /* reporting cannot change the selected failure mode */ }
      }
      if (this.config.failureMode === 'fail-open') return null;
      throw new RateLimiterStorageError(error);
    }
  }

  #withTimeout(operation) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Rate limiter store timed out after ${this.config.timeoutMs}ms`)), this.config.timeoutMs);
      Promise.resolve(operation).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  #headers(result, nowMs) {
    return {
      'RateLimit-Limit': String(result.limit),
      'RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'RateLimit-Reset': String(Math.max(0, Math.ceil((result.resetAfterMs ?? (result.resetAt - nowMs)) / 1000))),
      'RateLimit-Policy': `${result.limit};w=${Math.max(1, Math.ceil(result.windowMs / 1000))}`
    };
  }

  cleanup() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownsStore && typeof this.store.close === 'function') void this.store.close();
  }

  async shutdown() {
    if (this.disposed && !this.ownsStore) return;
    this.disposed = true;
    if (this.ownsStore && typeof this.store.close === 'function') await this.store.close();
  }
}

export { MemoryStore } from './rate-limiter/MemoryStore.js';
export { RedisStore } from './rate-limiter/RedisStore.js';
export { RateLimitExceededError, RateLimiterStorageError } from './rate-limiter/errors.js';
export { algorithms, algorithmNames } from './rate-limiter/algorithms/index.js';
