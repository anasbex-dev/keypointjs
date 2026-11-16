// All state transitions happen within one Redis Lua invocation. Redis TIME is used so
// workers do not rely on synchronized application clocks for distributed elapsed time.
export const REDIS_CONSUME_SCRIPT = String.raw`
local algorithm = ARGV[1]
local limit = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local burst = tonumber(ARGV[4])
local member = ARGV[5]
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local allowed = 0
local remaining = 0
local retry = 0
local reset = now + window

if algorithm == 'sliding-window-log' then
  local cutoff = now - window
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
  local count = redis.call('ZCARD', KEYS[1])
  if count < limit then
    redis.call('ZADD', KEYS[1], now, member)
    count = count + 1
    allowed = 1
  end
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  if oldest[2] then reset = tonumber(oldest[2]) + window end
  if not allowed then
    retry = math.max(1, reset - now)
  end
  remaining = math.max(0, limit - count)
  if reset <= now then reset = now + 1 end
  redis.call('PEXPIRE', KEYS[1], math.max(1, reset - now))
  return {allowed, remaining, retry, reset, math.max(0, reset - now)}
end

if algorithm == 'fixed-window' then
  local windowStart = math.floor(now / window) * window
  local storedStart = tonumber(redis.call('HGET', KEYS[1], 'windowStart') or '-1')
  local count = 0
  if storedStart == windowStart then count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0') end
  reset = windowStart + window
  if count < limit then count = count + 1; allowed = 1 else retry = math.max(1, reset - now) end
  remaining = math.max(0, limit - count)
  redis.call('HSET', KEYS[1], 'windowStart', windowStart, 'count', count)
  redis.call('PEXPIRE', KEYS[1], math.max(1, reset - now))
  return {allowed, remaining, retry, reset, math.max(0, reset - now)}
end

if algorithm == 'sliding-window-counter' then
  local windowStart = math.floor(now / window) * window
  local storedStart = tonumber(redis.call('HGET', KEYS[1], 'windowStart') or '-1')
  local current = 0
  local previous = 0
  if storedStart == windowStart then
    current = tonumber(redis.call('HGET', KEYS[1], 'currentCount') or '0')
    previous = tonumber(redis.call('HGET', KEYS[1], 'previousCount') or '0')
  elseif storedStart == windowStart - window then
    previous = tonumber(redis.call('HGET', KEYS[1], 'currentCount') or '0')
  end
  local elapsed = now - windowStart
  local weighted = current + previous * (1 - elapsed / window)
  if weighted < limit then current = current + 1; allowed = 1 else
    if current >= limit then
      retry = window - elapsed + 1
    elseif previous == 0 then
      retry = window - elapsed + 1
    else
      local target = (1 - (limit - current) / previous) * window
      retry = math.max(1, target - elapsed + 1)
    end
  end
  remaining = math.max(0, math.floor(limit - (current + previous * (1 - elapsed / window))))
  if allowed == 1 then reset = windowStart + window else reset = now + retry end
  redis.call('HSET', KEYS[1], 'windowStart', windowStart, 'currentCount', current, 'previousCount', previous)
  redis.call('PEXPIRE', KEYS[1], window * 2)
  return {allowed, remaining, retry, reset, math.max(0, reset - now)}
end

if algorithm == 'token-bucket' or algorithm == 'leaky-bucket' then
  local rate = limit / window
  local updatedAt = tonumber(redis.call('HGET', KEYS[1], 'updatedAt') or tostring(now))
  local elapsed = math.max(0, now - updatedAt)
  if algorithm == 'token-bucket' then
    local value = tonumber(redis.call('HGET', KEYS[1], 'tokens') or tostring(burst))
    local available = math.min(burst, value + elapsed * rate)
    if available >= 1 then available = available - 1; allowed = 1 else retry = math.max(1, math.ceil((1 - available) / rate)) end
    remaining = math.max(0, math.floor(available))
    if allowed == 1 then reset = now + math.ceil((burst - available) / rate) else reset = now + retry end
    redis.call('HSET', KEYS[1], 'tokens', available, 'updatedAt', now)
    redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil((burst - available) / rate)))
  else
    local water = tonumber(redis.call('HGET', KEYS[1], 'water') or '0')
    local leaked = math.max(0, water - elapsed * rate)
    if leaked + 1 <= burst then leaked = leaked + 1; allowed = 1 else retry = math.max(1, math.ceil((leaked + 1 - burst) / rate)) end
    remaining = math.max(0, math.floor(burst - leaked))
    if allowed == 1 then reset = now + math.ceil(leaked / rate) else reset = now + retry end
    redis.call('HSET', KEYS[1], 'water', leaked, 'updatedAt', now)
    redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil(leaked / rate)))
  end
  return {allowed, remaining, retry, reset, math.max(0, reset - now)}
end

return redis.error_reply('Unsupported KeyPointJS rate-limit algorithm')
`;
