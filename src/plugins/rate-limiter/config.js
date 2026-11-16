import { performance } from 'node:perf_hooks';
import { algorithmNames } from './algorithms/index.js';

const KEY_STRATEGIES = new Set(['global', 'ip', 'user', 'keypoint', 'apiKey', 'route', 'custom']);

function positiveInteger(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeDynamic(value, name) {
  if (typeof value === 'function') return value;
  return positiveInteger(value, name);
}

function normalizePolicy(policy, index, defaults = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError(`Rate limit policy at index ${index} must be an object`);
  }
  const id = policy.id ?? `policy-${index + 1}`;
  if (typeof id !== 'string' || !id.trim() || id.length > 128) {
    throw new TypeError(`Rate limit policy at index ${index} must have a non-empty id of at most 128 characters`);
  }

  const algorithm = policy.algorithm ?? defaults.algorithm ?? 'fixed-window';
  if (!algorithmNames.includes(algorithm)) {
    throw new TypeError(`Unsupported rate limit algorithm "${algorithm}"`);
  }

  const keyBy = policy.keyBy ?? policy.type ?? defaults.keyBy ?? 'keypoint';
  if (!KEY_STRATEGIES.has(keyBy)) {
    throw new TypeError(`Unsupported rate limit keyBy strategy "${keyBy}"`);
  }

  const limit = normalizeDynamic(policy.limit ?? policy.max ?? defaults.limit, `Rate limit policy "${id}" limit`);
  const windowMs = normalizeDynamic(policy.windowMs ?? policy.window ?? defaults.windowMs, `Rate limit policy "${id}" windowMs`);
  const burst = policy.burst === undefined ? undefined : normalizeDynamic(policy.burst, `Rate limit policy "${id}" burst`);
  const maxLogEntries = policy.maxLogEntries === undefined ? defaults.maxLogEntries : positiveInteger(policy.maxLogEntries, `Rate limit policy "${id}" maxLogEntries`);
  const priority = policy.priority ?? 0;
  if (!Number.isFinite(priority)) throw new TypeError(`Rate limit policy "${id}" priority must be finite`);

  const match = policy.match ?? {};
  if (!match || typeof match !== 'object' || Array.isArray(match)) {
    throw new TypeError(`Rate limit policy "${id}" match must be an object`);
  }
  const methods = match.method === undefined ? null : (Array.isArray(match.method) ? match.method : [match.method]);
  const paths = match.path === undefined ? null : (Array.isArray(match.path) ? match.path : [match.path]);
  if (methods && methods.some((method) => typeof method !== 'string' || !/^[A-Za-z]+$/.test(method))) {
    throw new TypeError(`Rate limit policy "${id}" match.method must contain HTTP method names`);
  }
  if (paths && paths.some((path) => typeof path !== 'string' || !path.startsWith('/'))) {
    throw new TypeError(`Rate limit policy "${id}" match.path must contain absolute pathnames`);
  }
  for (const [name, fn] of [['when', policy.when], ['exempt', policy.exempt], ['keyGenerator', policy.keyGenerator]]) {
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError(`Rate limit policy "${id}" ${name} must be a function`);
  }

  return Object.freeze({
    id,
    algorithm,
    keyBy,
    limit,
    windowMs,
    burst,
    priority,
    methods: methods && Object.freeze(methods.map((method) => method.toUpperCase())),
    paths: paths && Object.freeze([...paths]),
    when: policy.when,
    exempt: policy.exempt,
    keyGenerator: policy.keyGenerator,
    maxLogEntries
  });
}

export function normalizeRateLimiterOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('RateLimiter options must be an object');
  }
  const algorithm = options.algorithm ?? 'fixed-window';
  if (!algorithmNames.includes(algorithm)) throw new TypeError(`Unsupported rate limit algorithm "${algorithm}"`);
  if (options.keyBy !== undefined && !KEY_STRATEGIES.has(options.keyBy)) throw new TypeError(`Unsupported rate limit keyBy strategy "${options.keyBy}"`);
  const windowMs = positiveInteger(options.windowMs ?? options.window ?? 60_000, 'RateLimiter windowMs');
  const limit = positiveInteger(options.limit ?? options.max ?? 100, 'RateLimiter limit');
  const burst = options.burst === undefined ? undefined : positiveInteger(options.burst, 'RateLimiter burst');
  const failureMode = options.failureMode ?? 'fail-closed';
  if (!['fail-open', 'fail-closed'].includes(failureMode)) throw new TypeError('failureMode must be "fail-open" or "fail-closed"');
  const timeoutMs = positiveInteger(options.timeoutMs ?? 1000, 'RateLimiter timeoutMs');
  const maxKeys = positiveInteger(options.maxKeys ?? 100_000, 'RateLimiter maxKeys');
  const cleanupIntervalMs = positiveInteger(options.cleanupIntervalMs ?? 60_000, 'RateLimiter cleanupIntervalMs');
  const cleanupBatchSize = positiveInteger(options.cleanupBatchSize ?? 256, 'RateLimiter cleanupBatchSize');
  const maxIdentityLength = positiveInteger(options.maxIdentityLength ?? 512, 'RateLimiter maxIdentityLength', { max: 4096 });
  const maxLogEntries = positiveInteger(options.maxLogEntries ?? 10_000, 'RateLimiter maxLogEntries');
  const namespace = options.namespace ?? 'keypointjs:ratelimit';
  if (typeof namespace !== 'string' || !namespace.trim() || namespace.length > 128) throw new TypeError('RateLimiter namespace must be a non-empty string of at most 128 characters');
  if (options.keyGenerator !== undefined && typeof options.keyGenerator !== 'function') throw new TypeError('RateLimiter keyGenerator must be a function');
  if (options.exempt !== undefined && typeof options.exempt !== 'function') throw new TypeError('RateLimiter exempt must be a function');
  if (options.onLimitReached !== undefined && typeof options.onLimitReached !== 'function') throw new TypeError('RateLimiter onLimitReached must be a function');
  if (options.onError !== undefined && typeof options.onError !== 'function') throw new TypeError('RateLimiter onError must be a function');
  if (options.clock !== undefined && typeof options.clock !== 'function' && typeof options.clock.now !== 'function') {
    throw new TypeError('RateLimiter clock must be a function or provide now()');
  }
  if (options.keyHashSecret !== undefined && (typeof options.keyHashSecret !== 'string' || options.keyHashSecret.length < 16)) {
    throw new TypeError('RateLimiter keyHashSecret must be a string with at least 16 characters');
  }
  if (options.redis !== undefined && (!options.redis || typeof options.redis.eval !== 'function')) {
    throw new TypeError('RateLimiter redis must be a connected-compatible client with eval()');
  }
  if (options.redisOptions !== undefined && (!options.redisOptions || typeof options.redisOptions !== 'object' || Array.isArray(options.redisOptions))) {
    throw new TypeError('RateLimiter redisOptions must be an object');
  }
  if (options.responseBody !== undefined && typeof options.responseBody !== 'function' && (!options.responseBody || typeof options.responseBody !== 'object')) {
    throw new TypeError('RateLimiter responseBody must be an object or function');
  }

  const policies = [];
  if (options.global !== undefined) {
    if (!options.global || typeof options.global !== 'object' || Array.isArray(options.global)) throw new TypeError('RateLimiter global policy must be an object');
    policies.push(normalizePolicy({ ...options.global, id: options.global.id ?? 'global', keyBy: 'global' }, policies.length, { algorithm, limit, windowMs, maxLogEntries }));
  }
  if (options.policies !== undefined && !Array.isArray(options.policies)) throw new TypeError('RateLimiter policies must be an array');
  for (const policy of options.policies || []) {
    policies.push(normalizePolicy(policy, policies.length, { algorithm, limit, windowMs, maxLogEntries }));
  }
  const policyIds = new Set();
  for (const policy of policies) {
    if (policyIds.has(policy.id)) throw new TypeError(`Duplicate rate limit policy id "${policy.id}"`);
    policyIds.add(policy.id);
  }
  if (options.store !== undefined && (!options.store || typeof options.store.consume !== 'function')) {
    throw new TypeError('RateLimiter store must implement consume(request)');
  }
  if (options.store !== undefined && options.redis !== undefined) throw new TypeError('Configure either a custom store or Redis, not both');

  if (algorithm === 'sliding-window-log' && Number.isInteger(limit) && limit > (options.maxLogEntries ?? 10_000)) {
    throw new TypeError(`sliding-window-log limit cannot exceed maxLogEntries (${options.maxLogEntries ?? 10_000})`);
  }

  return Object.freeze({
    ...options,
    algorithm,
    limit,
    max: limit,
    windowMs,
    window: windowMs,
    burst,
    failureMode,
    timeoutMs,
    maxKeys,
    cleanupIntervalMs,
    cleanupBatchSize,
    maxIdentityLength,
    maxLogEntries,
    namespace,
    policies: Object.freeze(policies),
    clock: options.clock ?? (() => performance.now())
  });
}

export function normalizeResolvedLimit(value, name = 'limit') {
  return positiveInteger(value, name);
}

export function normalizeResolvedWindow(value, name = 'windowMs') {
  return positiveInteger(value, name);
}

export function normalizeResolvedBurst(value, name = 'burst') {
  return positiveInteger(value, name);
}
