# Configuration

`new KeypointJS(options = {})` shallow-merges the supplied object over these principal defaults:

| Option | Default | Behavior / note |
| --- | --- | --- |
| `requireKeypoint` | `true` | Enables keypoint validation middleware. |
| `strictMode` | `true` | Retained in options; source does not currently use it to alter behavior. |
| `validateOrigin` | `true` | Checks keypoint origin through context validation. |
| `validateProtocol` | `true` | Checks keypoint protocol. |
| `enableCORS` | `false` | Adds CORS middleware when enabled. |
| `corsOrigins` | `['*']` | Origins allowed by CORS middleware. |
| `maxRequestSize` | `'10mb'` | Forwarded as protocol engine body limit. |
| `defaultResponseHeaders` | KeyPointJS and nosniff headers | Merged into framework responses. |
| `errorHandler` | bound default handler | Handles request pipeline errors. |
| `trustedProxies` | `[]` | Proxy addresses/ranges trusted for forwarded client IP extraction. |
| `enableWebSocket` | `true` | Allows WebSocket guard attachment; a guard is still opt-in. |
| `enableGrpc` | `false` | Current server implementation is placeholder; not functional gRPC support. |
| `enableHttp2` | `true` | Stored/configured option; current server creation shown here uses Node HTTP/HTTPS servers. |
| `enableHttp3` | `false` | No implemented HTTP/3 server. |
| `protocolEngines` | `{}` | Custom engine configuration passed to `ProtocolEngine`. |
| `keypointStorage` | in-memory storage | Custom storage instance. |
| `enableAuditLog` | enabled unless `false` | Registers built-in audit logger. |
| `auditToConsole` | enabled unless `false` | Console output for audit logger. |
| `auditToFile` | `false` | Enables file logging. |
| `auditFilePath` | `'./audit.log'` | File path for audit logging. |
| `enableRateLimiter` | enabled unless `false` | Registers built-in limiter plugin. |
| `rateLimitWindow` / `rateLimitMax` | 60,000 ms / 100 | Forwarded to plugin options; implementation details and limitations on [Rate Limiting](rate-limiting.md). |

`configure(options)` merges new values into `api.options`; not every live subsystem is rebuilt when options change. Prefer constructor configuration for options used during initialization. `configureProtocolEngine(options)` replaces the protocol engine with one merged from prior engine options. `enableWebSocket(options)` creates a guard and returns it.

## Starting and stopping

```js
const servers = await api.listen(3000, '127.0.0.1');
// Later, when your application is shutting down:
await api.shutdown();
```

`listen` is asynchronous and resolves server handles. `createServer()` creates the HTTP server without listening. HTTPS creation requires an `https` option containing Node TLS server options. The built-in server currently does not establish HTTP/2 or HTTP/3 despite those option names. Avoid relying on placeholder gRPC configuration.

Configuration is not itself a security review. See [Security Best Practices](security-best-practices.md).
