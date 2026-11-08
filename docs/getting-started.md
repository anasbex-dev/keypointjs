# Getting Started

KeyPointJS is a Node.js framework for API authentication and authorization. Its core uses keypoints to identify callers, a middleware pipeline, scope checks, policy rules, plugins, and a minimal HTTP router. It is not a general purpose web framework and does not promise that an application is secure without appropriate configuration and review.

## Requirements and installation

KeyPointJS requires Node.js 18 or later and is published as an ES module.

```sh
npm install keypointjs
```

## Minimal protected API

Save as `server.js` in an npm project with `"type": "module"`:

```js
import { KeypointJS } from 'keypointjs';

const api = new KeypointJS({
  enableAuditLog: false,
  enableRateLimiter: false
});

await api.createKeypoint({
  keyId: 'local-demo',
  secret: 'replace-this-local-secret',
  scopes: ['api:public'],
  protocols: ['http']
});

api.get('/hello', (ctx) => {
  if (!ctx.hasScope('api:public')) {
    return ctx.status(403).json({ error: 'Insufficient scope' });
  }
  return ctx.json({ message: 'Hello', keypointId: ctx.getKeypointId() });
});

await api.listen(3000, '127.0.0.1');
```

Run it with `node server.js`, then call it from another terminal:

```sh
curl http://127.0.0.1:3000/hello \
  -H 'X-Keypoint-ID: local-demo' \
  -H 'X-Keypoint-Secret: replace-this-local-secret'
```

Expected JSON response:

```json
{"message":"Hello","keypointId":"local-demo"}
```

The secret is verified only if `X-Keypoint-Secret` is sent. The current validator requires a keypoint ID, accepted from `X-Keypoint-ID` or query parameter `keypointId`, but does not require a secret header. Do not treat the optional shared-secret check as a complete credential design. Keypoints default to the `https` protocol, hence this local example explicitly allows `http`.

## Common failures

* Missing or unknown ID, expired keypoint, or a supplied incorrect secret is rejected by validation (normally status 401).
* A keypoint that disallows the detected request protocol or origin is rejected (normally 403 when the relevant checks are enabled).
* A missing route returns 404.
* A policy denial returns 403.
* Handler errors pass through the configured error handler; inspect that handler and your application logs when diagnosing errors.

See [Authentication](authentication.md), [Authorization](authorization.md), [Configuration](configuration.md), and [Security Best Practices](security-best-practices.md).
