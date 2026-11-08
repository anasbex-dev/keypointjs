# WebSocket Security

WebSocket support is backed by the `ws` package and an optional `WebSocketGuard`, enabled only after `api.enableWebSocket(options)` or explicit plugin registration. The guard attaches to the framework's HTTP server when that server is created.

```js
const guard = api.enableWebSocket({
  path: '/ws',
  requireKeypoint: true,
  keypointHeader: 'x-keypoint-id',
  maxConnections: 100,
  pingInterval: 30_000
});

guard.onConnection((connection) => {
  console.log('connected', connection.id);
});
guard.onDisconnection((connection) => {
  console.log('disconnected', connection.id);
});
```

Implemented options are `path` (`/ws`), `verifyClient` (defaults to keypoint validation), `keypointHeader` (`x-keypoint-id`), `requireKeypoint` (`true`), `pingInterval` (30,000 ms), and `maxConnections` (1,000). Validation loads the keypoint using the request header and calls the normal validator. Query parameter keypoints and origin/protocol checks are not part of this WebSocket handshake path.

The guard provides `onConnection`, `onDisconnection`, `onMessage(type, handler)`, `broadcast(message, filter)`, `sendToConnection`, `getConnection(s)`, `disconnect`, `disconnectAll`, `getStats`, and `cleanup`. Messages are JSON; unmatched types receive an echo response. `cleanup()` clears the ping timer, closes active connections and the WebSocket server. Connection limits include pending handshakes.

Use TLS at the deployment boundary, protect credentials, and review custom `verifyClient` callbacks carefully. The guard is a small connection guard, not a general authorization layer for every message. Add per-message permission checks in application handlers when needed. See [Authentication](authentication.md) and [Security Best Practices](security-best-practices.md).
