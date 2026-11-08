# Plugin System

Plugins are objects registered with `api.registerPlugin(plugin, options)`. A plugin can participate in request processing with `process(context, next)`, expose `hooks`, and implement lifecycle methods. Registration records the plugin by its constructor name, merges explicit registration options over existing constructor options, and rejects duplicate names.

```js
const plugin = {
  options: { label: 'example' },
  async process(ctx, next) {
    ctx.setPluginData('ExamplePlugin', { startedAt: Date.now() });
    return next(ctx);
  }
};

api.registerPlugin(plugin, { label: 'configured' });
```

Plugin order follows registration order. Manager methods include `getPlugin`, `getAllPlugins`, `getPluginNames`, `getEnabledPlugins`, `enable`, `disable`, `unregister`, `configurePlugin`, `getStats`, `initialize`, and `shutdown`. Event and hook APIs are documented in the [API Reference](api-reference.md). Hook errors are logged and swallowed by the manager; do not use hooks as a guaranteed transactional boundary.

## Built-in plugins

* `AuditLogger`: default enabled. Constructor settings include `logToConsole`, `logToFile`, and `filePath`; it keeps an in-memory log buffer, supports `queryLogs(filter)` and `clearLogs()`, and has `cleanup()`. Treat audit output as potentially sensitive, and review retention/access controls.
* `RateLimiter`: default enabled; see [Rate Limiting](rate-limiting.md).
* `WebSocketGuard`: opt in with `api.enableWebSocket(options)`; see [WebSocket Security](websocket-security.md).

The transformer plugin is available as `keypointjs/plugins/transformer`, but it is not a root export or automatically installed. Its behavior is specialized; inspect its source before adopting it. Do not assume a plugin is enabled simply because its class is exported.
