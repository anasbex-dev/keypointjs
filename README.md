# KeypointJS - Complete Documentation

<div align="center">

![KeypointJS Banner](./assets/banner.png)

</div>

<div align="center">
<p align="center">
  <img alt="License" src="https://img.shields.io/github/license/anasbex-dev/keypointjs?color=blue">
  <img alt="Version" src="https://img.shields.io/npm/v/keypointjs">
  <img alt="Downloads" src="https://img.shields.io/npm/dm/keypointjs?style=for-the-badge">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Ready-blue">
  <img alt="Tests" src="https://img.shields.io/badge/tests-100%25%20passing-brightgreen">
</p>

**A Modern, Extensible Authentication & Authorization Framework for Node.js**

[Quick Start](#quick-start) • [Documentation](#documentation) • [Examples](#examples) • [Contributing](./CONTRIBUTING.md)
[Philosophy](./philosophyEN.md)

</div>

---

## Project Overview

KeypointJS is a layered authentication and authorization framework for Node.js, featuring:

* Secure, production-ready authentication & authorization
* Plugin architecture for extensibility
* Real-time WebSocket support
* Audit logging and monitoring
* Built-in policy engine and scope management

---

## Architecture

### Layered Middleware System

```
┌─────────────────────────────────┐
│ Layer 0: Pre-processing Hooks   │
├─────────────────────────────────┤
│ Layer 1: Protocol Engine        │
├─────────────────────────────────┤
│ Layer 2: CORS Middleware        │
├─────────────────────────────────┤
│ Layer 3: Keypoint Validation    │
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

---

## File Structure & Responsibilities

### Core Components (`core/`)

* **Context.js**: Base request context
* Request/Response wrapper
* State management
* Plugin data storage
* JSON, text, HTML helpers
* Header & query accessors

### Protocol Engine (`ProtocolEngine.js`)

* HTTP/HTTPS/WebSocket detection
* Body parsing (JSON, form data)
* IP extraction & validation
* Request size limiting

### Keypoint System (`keypoint/`)

* **Keypoint.js**: Keypoint entity, scopes, protocols, expiration
* **KeypointContext.js**: Context extension with scope checking, rate limiting, logging
* **KeypointStorage.js**: In-memory & file-based storage with indexing
* **KeypointValidator.js**: Extracts & validates keypoints
* **ScopeManager.js**: Manages scopes, hierarchy, wildcard patterns

### Policy Engine (`policy/`)

* **PolicyEngine.js**: Rule-based access control
* **PolicyRule.js**: Built-in & custom rules (method, origin, IP, rate, scope)
* **AccessDecision.js**: Aggregates rule results

### Plugin System (`plugins/`)

* **PluginManager.js**: Plugin registration, lifecycle, hooks
* **AuditLogger.js**: Request/response logging with rotation
* **RateLimiter.js**: Keypoint-based rate limiting
* **WebSocketGuard.js**: Secure WebSocket connections

### Router (`router/`)

* **MinimalRouter.js**: Simple HTTP router with method/path matching

### Main Framework (`keypointJS.js`)

* Orchestrates all components
* Server creation & configuration
* Statistics & health checks
* Event emission & error handling

---

## Quick Start

### Installation

```bash
npm install keypointjs
# or
yarn add keypointjs
# or
pnpm add keypointjs
```

### Initialization

```javascript
import { KeypointJS } from './src/keypointJS.js';

const api = new KeypointJS({
  requireKeypoint: true,
  strictMode: false,
  enableCORS: true,
  maxRequestSize: '5mb'
});
```

### Create Keypoint

```javascript
const keypoint = await api.createKeypoint({
  keyId: 'test_key',
  secret: 'test_secret',
  scopes: ['api:public', 'users:read'],
  protocols: ['https', 'wss'],
  allowedOrigins: ['https://example.com'],
  rateLimit: { requests: 1000, window: 3600 }
});
```

### Define Routes

```javascript
api.get('/api/data', (ctx) => {
  return ctx.json({
    data: 'protected data',
    keypointId: ctx.getKeypointId(),
    scopes: ctx.keypoint?.scopes
  });
});

api.post('/api/webhook', (ctx) => {
  return ctx.json({ received: true });
});
```

### Start Server

```javascript
api.listen(3000, 'localhost', () => {
  console.log('Server running on port 3000');
});
```

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
4. Ensure all tests pass (npm test)
5. Commit your changes (git commit -m 'Add amazing feature')
6. Push to the branch (git push origin feature/amazing-feature)
7. Open a Pull Request

---

## License

Apache-2.0 license - see the LICENSE file for details.

---

## Support

* Documentation: Full API documentation in source code
* Issues: Report bugs via GitHub issues
* Contributions: PRs welcome
* Questions: Open a discussion for usage questions

## KeypointJS is Independent

KeypointJS does not depend on Express, Fastify, or any third-party HTTP framework. It ships with its own HTTP server, routing system, middleware pipeline, and security layer.

## Created Base ♥️ KeypointJS

### AnasBex - (づ￣ ³￣)づ

KeypointJS provides a comprehensive, layered approach to API security with extensibility through plugins, real-time WebSocket capabilities, and detailed monitoring through audit logging. The framework is production-ready with built-in security features and can be extended to meet specific requirements.
