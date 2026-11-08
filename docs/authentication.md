# Authentication

KeyPointJS authenticates requests by loading a stored Keypoint using its ID, checking expiration, and checking a secret only when a secret header is supplied. This is the actual behavior of `KeypointValidator`; a secret is not currently mandatory.

## Create and store a keypoint

```js
const keypoint = await api.createKeypoint({
  keyId: 'client-a',
  secret: 'use-a-generated-secret',
  scopes: ['orders:read'],
  protocols: ['https'],
  allowedOrigins: ['https://app.example']
});
```

The keypoint is stored through the configured `keypointStorage`. Properties include `keyId`, `secret`, `scopes`, `protocols`, `allowedOrigins`, `allowedIps`, `rateLimit`, `expiresAt`, and `metadata`. `allowedIps` is currently data only and is not enforced by keypoint validation.

## Request flow

The validator reads `X-Keypoint-ID`, or `keypointId` from parsed query parameters. It rejects a missing ID, unknown keypoint, expired keypoint, or a supplied incorrect `X-Keypoint-Secret`. It then attaches the keypoint to `KeypointContext`. If enabled, origin and protocol checks follow. Protocol defaults to `https`; `validateOrigin` and `validateProtocol` are enabled by default. An empty `allowedOrigins` list accepts any origin; requests without Origin/Referer are accepted by the context origin check.

```http
GET /orders HTTP/1.1
X-Keypoint-ID: client-a
X-Keypoint-Secret: use-a-generated-secret
```

Typical outcomes are 401 for authentication failure and 403 for configured origin/protocol or policy denial. Exact error response formatting comes from `defaultErrorHandler` or the configured `errorHandler`.

## Security limitations

The current secret verification compares strings directly, and the API does not mandate a secret header. Do not infer hashed-at-rest credential handling, timing-safe comparison, automatic rotation, or a complete credential lifecycle from this implementation. Use TLS, generate high-entropy credentials, control access to storage, and review error/log handling. See [Security Best Practices](security-best-practices.md).
