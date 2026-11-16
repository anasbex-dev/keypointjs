/** Token bucket with refill rate limit/window and a separately configurable burst capacity. */
export function consumeTokenBucket(state, config, nowMs) {
  const capacity = config.burst;
  const ratePerMs = config.limit / config.windowMs;
  const lastRefillAt = Math.max(state?.updatedAt ?? nowMs, nowMs);
  const elapsed = Math.max(0, nowMs - (state?.updatedAt ?? nowMs));
  const tokens = Math.min(capacity, (state?.tokens ?? capacity) + elapsed * ratePerMs);
  const allowed = tokens >= 1;
  const nextTokens = allowed ? tokens - 1 : tokens;
  const retryAfterMs = allowed ? 0 : Math.max(1, Math.ceil((1 - tokens) / ratePerMs));
  const fullAt = nowMs + Math.ceil((capacity - nextTokens) / ratePerMs);

  return {
    state: { tokens: nextTokens, updatedAt: lastRefillAt },
    allowed,
    remaining: Math.max(0, Math.floor(nextTokens)),
    retryAfterMs,
    resetAt: allowed ? fullAt : nowMs + retryAfterMs,
    expiresAt: fullAt
  };
}
