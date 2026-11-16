/** Exact sliding window. A hit at exactly now-windowMs is outside the window. */
export function consumeSlidingWindowLog(state, config, nowMs) {
  const cutoff = nowMs - config.windowMs;
  const timestamps = (state?.timestamps || []).filter((timestamp) => timestamp > cutoff);
  const allowed = timestamps.length < config.limit;
  if (allowed) timestamps.push(nowMs);

  const oldest = timestamps[0] ?? nowMs;
  const resetAt = oldest + config.windowMs;
  return {
    state: { timestamps },
    allowed,
    remaining: Math.max(0, config.limit - timestamps.length),
    retryAfterMs: allowed ? 0 : Math.max(1, resetAt - nowMs),
    resetAt,
    expiresAt: resetAt
  };
}
