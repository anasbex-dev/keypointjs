# KeyPointJS

<div align="center">

![KeypointJS Banner](./assets/banner.png)

</div>

<div align="center">
<p align="center">
  <img alt="License" src="https://img.shields.io/github/license/anasbex-dev/keypointjs?color=blue">
  <img alt="Version" src="https://img.shields.io/npm/v/keypointjs">
  <img alt="Downloads" src="https://img.shields.io/npm/dm/keypointjs?style=for-the-badge">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green">

  [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/anasbex)
</p>

**A security-focused API authentication and authorization framework for Node.js**

[Quick Start](#quick-start) • [Architecture](#architecture) • [HTML Parser](#html-parser) • [Contributing](./CONTRIBUTING.md) •
[Philosophy](./philosophyEN.md) • 
[KeypointJS Web](https://keypointjs.vercel.app)

</div>

---

## Project Overview

KeyPointJS is primarily an API security framework. Its request pipeline supports:

* Keypoint validation, expiration checks, and optional secret verification.
* Scope checks, including registered scope inheritance.
* Policy rules for methods, origins, IP addresses, rate limits, time windows, and scopes.
* Optional origin validation, CORS handling, and trusted-proxy-aware client IP extraction.
* Built-in audit logging and rate-limiter plugins, plus custom plugins and hooks.
* HTTP routing, request processing, and an optional WebSocket guard.

The framework provides security mechanisms, but deployment security depends on configuration and review of the specific policies in use. See [Security notes](#security-notes).

---

## Architecture

### Layered Middleware System

```
┌─────────────────────────────────┐
│ Layer 0: Pre-processing Hooks   │
├─────────────────────────────────┤
│ Layer 1: Protocol Engine        │
├─────────────────────────────────┤
│ Layer 2: CORS (when enabled)     │
├─────────────────────────────────┤
│ Layer 3: Keypoint validation*   │
├─────────────────────────────────┤
│ Layer 4: Policy Check           │
├─────────────────────────────────┤
│ Layer 5: Plugin Processing      │
├─────────────────────────────────┤
│ Layer 6: Route Execution        │
├─────────────────────────────────┤
│ Layer 7: Response Processing    │
└─────────────────────────────────┘
```

`*` Keypoint validation runs when `requireKeypoint` is enabled (the default). CORS middleware is added only when `enableCORS` is enabled. Policy evaluation, plugins, routing, and response processing follow in that order.

---

## File Structure & Responsibilities

```text
src/
  core/          Protocol engines, base context, and plugin manager
  keypoint/      Keypoint model, validation, storage, request context, and scopes
  policy/        Policy engine, built-in rules, and access decisions
  plugins/       Audit logger, rate limiter, WebSocket guard, and transformer
  router/        Minimal HTTP method/path router
  html/          Optional HTML parser and DOM facade
  keypointJS.js  Framework composition, middleware, server, and public API
```

Core request processing is separate from the optional HTML Parser. The parser is imported through its own package subpath and is not part of API request handling.

---

## Quick Start

### Installation

```bash
npm install keypointjs
```

### Initialization

```javascript
import { KeypointJS } from 'keypointjs';

const api = new KeypointJS({
  maxRequestSize: '5mb'
});

await api.createKeypoint({
  keyId: 'local-demo',
  secret: 'replace-with-a-local-demo-secret',
  scopes: ['api:public'],
  protocols: ['http']
});

api.get('/api/data', (ctx) => {
  if (!ctx.hasScope('api:public')) {
    return ctx.status(403).json({ error: 'Insufficient scope' });
  }

  return ctx.json({
    message: 'Authenticated API request',
    keypointId: ctx.getKeypointId()
  });
});

await api.listen(3000, '127.0.0.1');
```

The key ID and secret above are local placeholders. The current validator requires a keypoint ID, normally supplied through `X-Keypoint-ID`; it also accepts the `keypointId` query parameter. It verifies `X-Keypoint-Secret` only when that header is supplied, so the secret header is not mandatory. This example sends both headers, but consumers should account for the validator's actual behavior when designing authentication.

Call the route with:

```bash
curl http://127.0.0.1:3000/api/data \
  -H "X-Keypoint-ID: local-demo" \
  -H "X-Keypoint-Secret: replace-with-a-local-demo-secret"
```

---

## HTML Parser

The HTML Parser is an optional supporting module for parsing HTML and querying a DOM-like tree. It is available at `keypointjs/html-parser`; its `parse5`, `css-select`, and `css-what` packages are declared in `optionalDependencies`. The main KeyPointJS entry point does not eagerly load these parser dependencies. Consumers who do not need HTML parsing can omit optional dependencies.

See the [HTML Parser guide](./docs/html-parser.md) for imports, limits, DOM methods, selectors, examples, and limitations. The HTML Parser does not fetch URLs; WebScraper has not been implemented.

---

## Security Notes

* Keypoint validation is enabled by default. The validator requires a keypoint ID and checks expiration; secret verification occurs only when a secret header is present.
* Origin validation is enabled by default, but a keypoint with no `allowedOrigins` accepts any origin. Configure an explicit allowlist where origin validation is required.
* `Keypoint.allowedIps` is currently stored on the keypoint but is not enforced by the request validator. The exported IP policy rule is separate, and its CIDR matching is simplified; do not rely on that CIDR check as a security boundary.
* The framework includes security components, but this README does not claim independent security verification or production readiness. Review the implementation and deployment configuration for your use case.

---

## Authentication Flow

1. **Request with Keypoint**

```http
GET /api/data HTTP/1.1
Host: localhost:3000
X-Keypoint-ID: test_key
X-Keypoint-Secret: test_secret
```

2. **Validation Process**

```text
Layer 1: ProtocolEngine (detect, parse)
Layer 2: KeypointValidator (validate keypoint)
Layer 3: PolicyEngine (evaluate rules)
Layer 4: Router (execute handler)
Layer 5: Response (format & return)
```

3. **Scope-Based Authorization**

```javascript
api.get('/api/users', (ctx) => {
  if (!ctx.hasScope('users:read')) {
    return ctx.status(403).json({ error: 'Insufficient scope' });
  }
  // Return user data
});
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (git checkout -b feature/amazing-feature)
3. Add tests for your changes
4. Run relevant tests (`npm test`; `npm run test:all` runs all test files)
5. Commit your changes (git commit -m 'Add amazing feature')
6. Push to the branch (git push origin feature/amazing-feature)
7. Open a Pull Request

---

## License

Apache-2.0 license - see the LICENSE file for details.

---

## Support

* Documentation: [README](./README.md) and [HTML Parser guide](./docs/html-parser.md)
* Issues: Report bugs via GitHub issues
* Contributions: PRs welcome
* Questions: Open a discussion for usage questions

## KeypointJS is Independent

KeyPointJS does not depend on Express, Fastify, or another third-party HTTP framework. It uses Node.js HTTP server APIs, its own routing system, middleware pipeline, and security components.

## Design Principles

* **Security first:** authentication and authorization remain the framework's primary purpose. Security behavior should be described according to the implementation, without unsupported guarantees.
* **Modular architecture:** request processing, validation, policies, plugins, and routing have separate modules.
* **Backward compatibility:** additive modules should not change existing core imports or APIs.
* **Minimal dependencies:** runtime dependencies are kept focused; HTML parsing dependencies are optional.
* **Core and optional separation:** optional utilities must not be required to import or use the API security core.

## Created Base ♥️ KeypointJS

### AnasBex - (づ￣ ³￣)づ

KeyPointJS is developed as a layered API authentication and authorization framework, with plugin extension points, WebSocket guarding, and audit logging.
