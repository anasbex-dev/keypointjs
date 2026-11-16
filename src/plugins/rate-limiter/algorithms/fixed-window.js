/** Fixed-window counter. The window is [floor(now/window)*window, start+window). */
export function consumeFixedWindow(state, config, nowMs) {
  const windowStart = Math.floor(nowMs / config.windowMs) * config.windowMs;
  const count = state?.windowStart === windowStart ? state.count : 0;
  const allowed = count < config.limit;
  const nextCount = allowed ? count + 1 : count;
  const resetAt = windowStart + config.windowMs;

  return {
    state: { windowStart, count: nextCount },
    allowed,
    remaining: Math.max(0, config.limit - nextCount),
    retryAfterMs: allowed ? 0 : Math.max(1, resetAt - nowMs),
    resetAt,
    expiresAt: resetAt
  };
}
