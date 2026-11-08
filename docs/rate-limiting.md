# Rate Limiting

The codebase has two separate rate limiting mechanisms. They are not interchangeable and both are in-process memory counters.

## Built-in policy rule

`BuiltInRules.rateLimitRule(limit = 100, windowSeconds = 60)` is added globally by `KeypointJS` at startup as 100 requests per 60 seconds. It tracks timestamps in a closure-local map keyed by keypoint ID, falling back to IP. Add another instance only if you understand that it creates independent counters. It is not a distributed limiter and has no persistence.

## RateLimiter plugin

`RateLimiter({window})` is also registered by default unless `enableRateLimiter: false`; `window` is milliseconds and defaults to 60,000. The plugin reads `keypoint.rateLimit.requests`. Its map key uses the unrounded `Date.now() / window` value, so requests in a time interval can land in separate counters; the current implementation does not provide a reliable rate limit. It also stores counters in memory and is not distributed or durable. On limit it throws a generic `Error`; the current error does not reliably set an HTTP status code.

Disable the plugin via `new KeypointJS({enableRateLimiter:false})`. A custom application should load-test and review its own enforcement, status handling, memory bounds, and multi-process strategy before relying on it as an abuse-control boundary.

The framework passes `rateLimitWindow` as the plugin's `window` option, but `rateLimitMax` is not used by the plugin's request check; the effective configured count is the keypoint's `rateLimit.requests`. See [Configuration](configuration.md). Do not rely on this implementation as an abuse-control boundary without fixing and verifying its behavior in a separately approved code change.
