import { randomUUID } from 'node:crypto';
import { algorithmNames } from './algorithms/index.js';
import { REDIS_CONSUME_SCRIPT } from './redis-script.js';

/**
 * Atomic Redis adapter. Accepts node-redis v4 (`eval(script, {keys, arguments})`) or
 * ioredis (`eval(script, numKeys, ...args)`). The caller owns the client unless
 * `closeClient: true` is explicitly set.
 */
export class RedisStore {
  constructor(client, options = {}) {
    if (!client || typeof client.eval !== 'function') throw new TypeError('RedisStore requires a Redis client with eval()');
    this.client = client;
    this.prefix = options.prefix ?? 'keypointjs:ratelimit:';
    if (typeof this.prefix !== 'string' || !this.prefix) throw new TypeError('RedisStore prefix must be a non-empty string');
    this.closeClient = options.closeClient === true;
    this.maxLogEntries = options.maxLogEntries ?? 10_000;
    if (!Number.isSafeInteger(this.maxLogEntries) || this.maxLogEntries < 1) throw new TypeError('RedisStore maxLogEntries must be a positive safe integer');
    this.evalStyle = options.evalStyle ?? (client.status !== undefined && client.isOpen === undefined ? 'ioredis' : 'node-redis');
    if (!['node-redis', 'ioredis'].includes(this.evalStyle)) throw new TypeError('RedisStore evalStyle must be "node-redis" or "ioredis"');
    this.disposed = false;
  }

  async consume(request) {
    if (this.disposed) throw new Error('RedisStore is closed');
    const { key, algorithm, limit, windowMs, burst = limit } = request;
    if (typeof key !== 'string' || !key) throw new TypeError('RedisStore key must be a non-empty string');
    if (!algorithmNames.includes(algorithm)) throw new TypeError(`Unsupported rate limit algorithm "${algorithm}"`);
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(burst) || burst < 1) {
      throw new TypeError('RedisStore limit, windowMs, and burst must be positive safe integers');
    }
    if (algorithm === 'sliding-window-log' && limit > Math.min(request.maxLogEntries ?? this.maxLogEntries, this.maxLogEntries)) {
      throw new RangeError(`RedisStore sliding-window-log limit cannot exceed maxLogEntries (${this.maxLogEntries})`);
    }
    const redisKey = `${this.prefix}${key}`;
    const args = [algorithm, String(limit), String(windowMs), String(burst), randomUUID()];
    const raw = this.evalStyle === 'ioredis'
      ? await this.client.eval(REDIS_CONSUME_SCRIPT, 1, redisKey, ...args)
      : await this.client.eval(REDIS_CONSUME_SCRIPT, { keys: [redisKey], arguments: args });
    if (!Array.isArray(raw) || raw.length < 5) throw new TypeError('Redis rate-limit script returned an invalid result');
    const [allowed, remaining, retryAfterMs, resetAt, resetAfterMs] = raw.map(Number);
    if (![allowed, remaining, retryAfterMs, resetAt, resetAfterMs].every(Number.isFinite)) throw new TypeError('Redis rate-limit script returned non-numeric values');
    return { allowed: allowed === 1, limit, remaining, retryAfterMs, resetAt, resetAfterMs, algorithm };
  }

  async close() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.closeClient) return;
    if (typeof this.client.quit === 'function') await this.client.quit();
    else if (typeof this.client.disconnect === 'function') await this.client.disconnect();
  }

  dispose() { return this.close(); }
}
