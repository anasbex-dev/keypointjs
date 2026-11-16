/** Leaky bucket queue. Capacity is the maximum burst and leak rate is limit/window. */
export function consumeLeakyBucket(state, config, nowMs) {
  const capacity = config.burst;
  const ratePerMs = config.limit / config.windowMs;
  const previousAt = state?.updatedAt ?? nowMs;
  const elapsed = Math.max(0, nowMs - previousAt);
  const leaked = Math.max(0, (state?.water ?? 0) - elapsed * ratePerMs);
  const allowed = leaked + 1 <= capacity;
  const water = allowed ? leaked + 1 : leaked;
  const retryAfterMs = allowed ? 0 : Math.max(1, Math.ceil((leaked + 1 - capacity) / ratePerMs));
  const emptyAt = nowMs + Math.ceil(water / ratePerMs);

  return {
    state: { water, updatedAt: nowMs },
    allowed,
    remaining: Math.max(0, Math.floor(capacity - water)),
    retryAfterMs,
    resetAt: allowed ? emptyAt : nowMs + retryAfterMs,
    expiresAt: emptyAt
  };
}
