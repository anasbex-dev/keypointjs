import { performance } from 'node:perf_hooks';
import { MemoryStore } from '../src/plugins/rate-limiter/MemoryStore.js';

const operations = Number.parseInt(process.argv[2] || '100000', 10);
if (!Number.isSafeInteger(operations) || operations < 1) {
  throw new TypeError('Pass a positive integer operation count');
}

const store = new MemoryStore({ maxEntries: 10_000, cleanupIntervalMs: 60_000, autoCleanup: false });
const durations = [];
const started = performance.now();
for (let index = 0; index < operations; index++) {
  const before = performance.now();
  await store.consume({
    key: `benchmark:${index % 1000}`,
    algorithm: 'fixed-window',
    limit: 100_000,
    windowMs: 60_000,
    burst: 100_000,
    nowMs: 1_000
  });
  durations.push(performance.now() - before);
}
const elapsedMs = performance.now() - started;
durations.sort((a, b) => a - b);
const percentile = (fraction) => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))];

console.log(JSON.stringify({
  benchmark: 'KeyPointJS MemoryStore fixed-window consume',
  operations,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  operationsPerSecond: Math.round(operations / (elapsedMs / 1000)),
  latencyMs: {
    p50: Number(percentile(0.5).toFixed(4)),
    p95: Number(percentile(0.95).toFixed(4)),
    p99: Number(percentile(0.99).toFixed(4))
  },
  entries: store.entries.size,
  note: 'Informational single-process microbenchmark; not a production or Redis performance claim.'
}, null, 2));

await store.close();
