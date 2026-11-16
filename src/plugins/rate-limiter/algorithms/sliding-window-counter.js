/** Approximate sliding window using a weighted previous-window counter. */
export function consumeSlidingWindowCounter(state, config, nowMs) {
  const windowStart = Math.floor(nowMs / config.windowMs) * config.windowMs;
  let previousCount = 0;
  let currentCount = 0;

  if (state?.windowStart === windowStart) {
    previousCount = state.previousCount;
    currentCount = state.currentCount;
  } else if (state?.windowStart === windowStart - config.windowMs) {
    previousCount = state.currentCount;
  }

  const elapsed = nowMs - windowStart;
  const weight = 1 - elapsed / config.windowMs;
  const weightedCount = currentCount + previousCount * weight;
  const allowed = weightedCount < config.limit;
  if (allowed) currentCount++;

  let retryAfterMs = 0;
  if (!allowed) {
    if (currentCount >= config.limit) {
      // The current counter becomes the previous counter at the boundary; any older
      // previous-window traffic is discarded then, so it must not extend this wait.
      retryAfterMs = config.windowMs - elapsed + 1;
    } else if (previousCount === 0) {
      retryAfterMs = config.windowMs - elapsed + 1;
    } else {
      const targetElapsed = (1 - (config.limit - currentCount) / previousCount) * config.windowMs;
      retryAfterMs = Math.max(1, targetElapsed - elapsed + 1);
    }
  }

  const resetAt = windowStart + config.windowMs;
  return {
    state: { windowStart, previousCount, currentCount },
    allowed,
    remaining: Math.max(0, Math.floor(config.limit - (currentCount + previousCount * weight))),
    retryAfterMs,
    resetAt: allowed ? resetAt : nowMs + retryAfterMs,
    expiresAt: resetAt + config.windowMs
  };
}
