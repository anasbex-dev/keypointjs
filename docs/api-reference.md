# API Reference

This reference covers package exports, not every internal helper. The root import is `keypointjs`; listed subpaths are defined by `package.json` exports. Unless otherwise noted, methods described as asynchronous return promises. Check each API's notes: several exported classes are lower-level building blocks and are not automatically wired into `KeypointJS`.

## Main framework

```js
import { KeypointJS, PolicyError, ValidationError, ProtocolExamples } from 'keypointjs';
```

`new KeypointJS(options = {})` constructs a framework instance. See [Configuration](configuration.md). Built-in audit and rate limiter plugins are registered by default; set `enableAuditLog: false` and/or `enableRateLimiter: false` to disable them.

| Method | Behavior |
| --- | --- |
| `use(middleware)` | Appends async middleware `(ctx, next)`; returns the framework. |
| `route(method, path, handler)` | Registers a method/path handler; returns the framework. |
| `get(path, handler)`, `post`, `put`, `delete`, `patch`, `options` | HTTP route helpers; return the framework. |
| `createKeypoint(data)` | Async; constructs, stores, emits `keypoint:created`, returns a `Keypoint`. |
| `getKeypoint(keyId)`, `listKeypoints(filter)`, `revokeKeypoint(keyId)` | Async storage operations. Revoke returns boolean. |
| `defineScope(name, description, metadata)` | Registers a scope definition; returns the framework. |
| `addPolicyRule(rule)`, `addPolicy(name, policyFn)` | Adds a global rule or named policy; return the framework. |
| `registerPlugin(plugin, options)`, `enableWebSocket(options)` | Register plugin or create/register a WebSocket guard. |
| `listen(port, hostname, callback)` | Starts HTTP server; async. Resolves server handles. |
| `createServer()` | Async; creates, but does not listen on, an HTTP server. |
| `getProtocolEngine()`, `configureProtocolEngine(options)` | Get or replace protocol engine configuration; the latter returns the framework. |
| `enableProtocol(protocol, options)`, `getAvailableProtocols()`, `registerProtocolEngine(protocol, engine)` | Configure/list/register protocol engines; available protocols are not proof each transport is production-ready. |
| `handleRequest(request, response)` | Async internal-style request entry point; returns response data. |
| `on(event, handler)`, `off(event, handler)`, `emit(event, data)` | Framework event methods. |
| `configure(options)` | Merges configuration; returns the framework. |
| `getStats()`, `healthCheck()` | Returns statistics / async health information. |
| `shutdown()` | Async shutdown and cleanup. |

The public package does not export a separate `createGrpcServer` API. The current `enableGrpc` path is a placeholder and must not be treated as a working gRPC server.

## Request contexts

`Context` is exported from the root and `keypoint/context`. `KeypointContext` extends it and is used for framework requests. Context exposes `request`, `response`, `state`, `keypoint`, and `policyDecision`; helpers include `json(data, status=200)`, `text(data, status=200)`, `html(data, status=200)`, `status(code)`, `setHeader(key,value)`, `getHeader(key)`, `getQuery(key)`, `getAllQuery()`, `setState(key,value)`, and `getState(key)`. Getters include `body`, `protocol`, `ip`, `method`, and `path`.

`KeypointContext` adds `hasScope(scope)`, `hasAnyScope(scopes)`, `hasAllScopes(scopes)`, `getKeypointId()`, `getKeypointMetadata()`, `getRateLimitInfo()`, `logAccess(action, details)`, `validateOrigin()`, `validateProtocol()`, and getters `isAuthenticated`, `isExpired`, and `allowedMethods`.

## Keypoints and storage

```js
import { Keypoint, KeypointError, KeypointValidator, MemoryKeypointStorage } from 'keypointjs';
import { FileKeypointStorage } from 'keypointjs/keypoint/storage';
```

`new Keypoint(data)` accepts `keyId`, `secret`, `name`, `scopes`, `protocols`, `allowedOrigins`, `allowedIps`, `rateLimit`, `expiresAt`, `createdAt`, and `metadata`. Defaults are empty name/scopes/origins/IPs, `protocols: ['https']`, a rate limit of 100 requests per 60 seconds, current creation time, and empty metadata. Methods: `hasScope(scope)`, `isExpired()`, `validateOrigin(origin)`, `validateProtocol(protocol)`.

`KeypointStorage`/`MemoryKeypointStorage` methods: `set`, `get`, `getBySecret`, `getByName`, `getByScope`, `update`, `delete`, `list`, `count`, and `cleanupExpired`. These return promises. `FileKeypointStorage(filePath)` exposes the same methods plus `loadFromFile()` and `saveToFile()`; await its `ready` promise before relying on initialized contents. File persistence is JSON-based. Storage returns a `Keypoint` instance for loaded records.

`KeypointValidator(storage)` has async `validate(context)`, `extractKeypointId(request)`, and `verifySecret(keypoint, providedSecret)`. Validation throws `KeypointError` for missing/invalid/expired IDs or invalid supplied secret. Secrets are currently compared as plain string equality; applications should consider this limitation in credential storage and transport design.

## Scopes and authorization

`ScopeManager` (root or `keypoint/scopes`) provides `defineScope`, `addInheritance`, `validateScope`, `getScopeDefinition`, `getInheritedScopes`, `hasScope`, `hasAnyScope`, `hasAllScopes`, `expandScopes`, `reduceScopes`, `validateScopeRequest`, `createScopePattern`, `matchScopes`, `getAllScopes`, and `getScopeTree`. Built-in scope relationships are documented in [Scope Management](scope-management.md).

`PolicyEngine` (root or `policy`) provides `addRule(rule)`, `addPolicy(name, fn)`, async `evaluate(context)`, and `allow(config)` for a named policy function checking optional scope, method, and protocol constraints. Rules are evaluated first and any denial short-circuits. A keypoint's `metadata.policy` selects a registered policy after rules pass.

`PolicyRule(name, evaluator, options)` supports async `evaluate(context)`, `enable()`, `disable()`, and `setPriority(priority)`. Options include `priority`, `enabled`, and `description`; priority is stored but not used for sorting by the current engine. `BuiltInRules` factories are documented in [Policy Engine](policy-engine.md).

`AccessDecision` provides static `allow`/`deny`, `addRuleResult`, `merge`, `toJSON`, `getSummary`, and `getDebugInfo`. Note: current `PolicyEngine.evaluate()` returns plain decision objects, not `AccessDecision` instances.

## Plugins

`PluginManager` and `BuiltInHooks` are root exports. Manager methods include `register`, `unregister`, `enable`, `disable`, `process`, `on`, `off`, `emit`, `addHook`, `runHook`, `getPlugin`, `getAllPlugins`, `getPluginNames`, `getEnabledPlugins`, `configurePlugin`, `getStats`, `initialize`, `shutdown`, and `clear`. See [Plugin System](plugin-system.md). The declared `keypointjs/plugins` subpath currently points to a missing source file, so use the root import.

Built-in plugin exports: `AuditLogger` (`keypointjs/plugins/audit`), `RateLimiter` (`keypointjs/plugins/ratelimit`), and `WebSocketGuard` (`keypointjs/plugins/websocket`). Their supported options and limitations are described on their respective pages.

## Router and protocol utilities

`MinimalRouter` is exported at root and `keypointjs/router`. It has `route`, `get`, `post`, `put`, `delete`, and async `handle(context)`. Although KeypointJS has `patch` and `options` registration methods, `MinimalRouter` itself has no corresponding convenience methods; use `KeypointJS.patch/options` or `route(method, path, handler)`.

`ProtocolEngine`, `ProtocolError`, and `ProtocolExamples` are root exports; `ProtocolAdapter` is at `keypointjs/protocol`. `ProtocolAdapter` exposes `registerEngine`, `getEngine`, `detectProtocol`, `process`, `createServer`, `handleRequest`, `handleWebSocket`, and `on`. Protocol selection is implementation-level and supported behavior depends on configured engines. HTTP and WebSocket are the relevant server paths. gRPC-related code is incomplete/placeholder.

## Optional HTML Parser

`HTMLParser` is exported only from `keypointjs/html-parser`. It is optional and independent from the security core. See [HTML Parser](html-parser.md) for its full facade and selector limitations.
