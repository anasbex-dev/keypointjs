import { algorithms } from './algorithms/index.js';

export class StoreCapacityError extends Error {
  constructor(message = 'Rate limit memory store capacity reached') {
    super(message);
    this.name = 'StoreCapacityError';
    this.code = 'RATE_LIMIT_STORE_CAPACITY';
  }
}

/**
 * In-process, synchronous-atomic store. It is deliberately not shared between Node workers.
 * consume() has no await between read and write, so concurrent promises in one isolate cannot
 * observe an intermediate counter state.
 */
export class MemoryStore {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries ?? 100_000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
    this.cleanupBatchSize = options.cleanupBatchSize ?? 256;
    this.maxLogEntries = options.maxLogEntries ?? 10_000;
    if (options.clock !== undefined && typeof options.clock !== 'function' && typeof options.clock.now !== 'function') {
      throw new TypeError('MemoryStore clock must be a function or provide now()');
    }
    this.clock = typeof options.clock === 'function' ? options.clock : options.clock ? () => options.clock.now() : () => Date.now();
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new TypeError('MemoryStore maxEntries must be a positive safe integer');
    if (!Number.isSafeInteger(this.cleanupIntervalMs) || this.cleanupIntervalMs < 1) throw new TypeError('MemoryStore cleanupIntervalMs must be a positive safe integer');
    if (!Number.isSafeInteger(this.cleanupBatchSize) || this.cleanupBatchSize < 1) throw new TypeError('MemoryStore cleanupBatchSize must be a positive safe integer');
    if (!Number.isSafeInteger(this.maxLogEntries) || this.maxLogEntries < 1) throw new TypeError('MemoryStore maxLogEntries must be a positive safe integer');

    this.entries = new Map();
    this.cleanupIterator = null;
    this.disposed = false;
    this.timer = options.autoCleanup === false ? null : setInterval(() => {
      try { this.cleanup(this.cleanupBatchSize); } catch { /* Cleanup must not create an unhandled timer error. */ }
    }, this.cleanupIntervalMs);
    this.timer?.unref?.();
  }

  async consume(request) {
    if (this.disposed) throw new Error('MemoryStore is closed');
    const { key, algorithm, nowMs = this.clock() } = request;
    if (typeof key !== 'string' || !key) throw new TypeError('MemoryStore key must be a non-empty string');
    const consumeAlgorithm = algorithms[algorithm];
    if (!consumeAlgorithm) throw new TypeError(`Unsupported rate limit algorithm "${algorithm}"`);
    for (const name of ['limit', 'windowMs']) {
      if (!Number.isSafeInteger(request[name]) || request[name] < 1) throw new TypeError(`MemoryStore ${name} must be a positive safe integer`);
    }
    if (algorithm === 'sliding-window-log' && request.limit > Math.min(request.maxLogEntries ?? this.maxLogEntries, this.maxLogEntries)) {
      throw new RangeError(`MemoryStore sliding-window-log limit cannot exceed maxLogEntries (${this.maxLogEntries})`);
    }

    this.cleanup(this.cleanupBatchSize, nowMs);
    let entry = this.entries.get(key);
    if (!entry && this.entries.size >= this.maxEntries) throw new StoreCapacityError();

    const result = consumeAlgorithm(entry?.state, { ...request, burst: request.burst ?? request.limit }, nowMs);
    this.entries.set(key, {
      state: result.state,
      expiresAt: Math.max(result.expiresAt, nowMs + 1),
      lastAccess: nowMs
    });
    return {
      allowed: result.allowed,
      limit: request.limit,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
      resetAt: result.resetAt,
      algorithm
    };
  }

  cleanup(maxEntries = this.cleanupBatchSize, nowMs = this.clock()) {
    if (this.entries.size === 0) {
      this.cleanupIterator = null;
      return 0;
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TypeError('cleanup maxEntries must be a positive safe integer');
    this.cleanupIterator ||= this.entries.keys();
    let removed = 0;
    let examined = 0;
    while (examined < maxEntries) {
      const next = this.cleanupIterator.next();
      if (next.done) {
        this.cleanupIterator = this.entries.keys();
        break;
      }
      examined++;
      const entry = this.entries.get(next.value);
      if (entry && entry.expiresAt <= nowMs) {
        this.entries.delete(next.value);
        removed++;
      }
    }
    return removed;
  }

  async close() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.entries.clear();
    this.cleanupIterator = null;
  }

  dispose() { return this.close(); }
}
