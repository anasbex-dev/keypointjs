# KeypointJS - Complete Documentation

<div align="center">

![KeypointJS Banner](./assets/banner.png)

</div>

<div align="center">
<p align="center">
  <img alt="GitHub" src="https://img.shields.io/github/license/anasbex-dev/keypointjs?color=blue">
  <img alt="npm" src="https://img.shields.io/npm/v/keypointjs">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Ready-blue">
  <img alt="Tests" src="https://img.shields.io/badge/tests-100%25%20passing-brightgreen">
</p>
**A Modern, Extensible Authentication & Authorization Framework for Node.js**

[Getting Started](#-quick-start) • [Documentation](#-documentation) • [Examples](#-examples) • [Contributing](./CONTRIBUTING.md)

</div>


# Project Overview

KeypointJS is a sophisticated, layered authentication and authorization framework for Node.js with built-in security features, plugin architecture, and real-time capabilities.

# Architecture

Layered Middleware System

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
# File Structure & Responsibilities

## Core Components (core/)

- Context.js - Request Context Base Class

- Request/Response wrapper
- State management
- Plugin data storage
- Helper methods for JSON, text, HTML
responses
- Header and query parameter accessors

## ProtocolEngine.js - Protocol Detection & Processing

- HTTP/HTTPS/WebSocket protocol detection
- Request body parsing (JSON, form data)
- IP extraction from headers
- Body size limiting
- Protocol validation

# Keypoint System (keypoint/)

## Keypoint.js - Keypoint Entity

- Keypoint data model (keyId, secret, scopes, protocols)
- Scope validation methods
- Expiration checking
- Origin and protocol validation
- Rate limit configuration

## KeypointContext.js - Enhanced Context

- Extends base Context class
- Keypoint-specific methods (scope checking, rate limiting)
- Access logging
- Security validation (origin, protocol)
- Authentication state management

## KeypointStorage.js - Storage Abstraction

- In-memory storage with indexing
- File-based storage option
- CRUD operations with indexing by secret, name, scope
- Cleanup of expired keypoints
- List operations with filtering

## KeypointValidator.js - Authentication Validator

- Extracts keypoint from request headers/query
- Validates keypoint existence and expiration
- Secret verification
- Context attachment

## ScopeManager.js - Scope Management System

- Scope definition and hierarchy
- Inheritance system
- Scope validation and expansion
- Pattern matching for wildcard scopes
- Scope tree generation

# Policy Engine (policy/)

## PolicyEngine.js - Policy Evaluation Engine

- Rule-based access control
- Policy registration and evaluation
- Built-in policy templates (allow, deny)
- Context-based decision making

## PolicyRule.js - Rule Definitions

- Base PolicyRule class
- Built-in rules: method, origin, IP, time window, rate limit, scope, protocol
- Rule evaluation with metadata
- Priority and enablement controls

## AccessDecision.js - Decision Management

- Access decision data structure
 Allow/Deny decision creation
- Rule result aggregation
- Merge operations for chained decisions
- Debug information generation

# Plugin System (plugins/)

## PluginManager.js - Plugin Orchestration

- Plugin registration and lifecycle management
- Middleware chain composition
- Event and hook system
- Built-in hooks for request lifecycle
- Plugin statistics and management

## AuditLogger.js - Comprehensive Logging

- Request/response logging
- File-based logging with rotation
- Console output with colors
- Queryable log storage
· Error tracking and reporting

## RateLimiter.js - Rate Limiting

- Keypoint-based rate limiting
- Time window enforcement
- Request counting per window

## WebSocketGuard.js - WebSocket Security

- WebSocket server integration
- Keypoint validation for WebSocket connections
- Connection management and monitoring
- Message handling and broadcasting
- Ping/pong keepalive

# Router (router/)

## MinimalRouter.js - Simple HTTP Router

- Method-based route registration
- Direct path matching
- Request handling with context
- Route management

# Main Framework (keypointJS.js)

- Main class orchestrating all components
- Server creation and management
- Configuration system
- Statistics and health checks
- Event emission system
- Error handling

# Quick Start

Installation & Setup

``` bash

npm install keypointjs
# or
yarn add keypointjs
# or
pnpm add keypointjs

```

```javascript
import { KeypointJS } from './src/keypointJS.js';

// Initialize the framework
const api = new KeypointJS({
  requireKeypoint: true,
  strictMode: false,
  enableCORS: true,
  maxRequestSize: '5mb'
});

// Create and store a keypoint
const keypoint = await api.createKeypoint({
  keyId: 'test_key',
  secret: 'test_secret',
  scopes: ['api:public', 'users:read'],
  protocols: ['https', 'wss'],
  allowedOrigins: ['https://example.com'],
  rateLimit: {
    requests: 1000,
    window: 3600 // 1 hour
  }
});

// Define routes
api.get('/api/data', (ctx) => {
  return ctx.json({
    data: 'protected data',
    keypointId: ctx.getKeypointId(),
    scopes: ctx.keypoint?.scopes
  });
});

api.post('/api/webhook', (ctx) => {
  const body = ctx.body;
  // Process webhook
  return ctx.json({ received: true });
});

// Start server
api.listen(3000, 'localhost', () => {
  console.log('Server running on port 3000');
});
```

# Authentication Flow

1. Request with Keypoint

```http
GET /api/data HTTP/1.1
Host: localhost:3000
X-Keypoint-ID: test_key
X-Keypoint-Secret: test_secret
```

2. Validation Process

```javascript
// Layer-by-layer processing:
1. ProtocolEngine: Detect protocol, parse body
2. KeypointValidator: Extract and validate keypoint
3. PolicyEngine: Evaluate access rules
4. Router: Execute route handler
5. Response: Return formatted response
```

3. Scope-Based Authorization

```javascript
// Route requiring specific scope
api.get('/api/users', (ctx) => {
  if (!ctx.hasScope('users:read')) {
    return ctx.status(403).json({ error: 'Insufficient scope' });
  }
  // Return user data
});
```

# Configuration Options

KeypointJS Constructor Options

```javascript
const api = new KeypointJS({
  // Core settings
  requireKeypoint: true,       // Require authentication
  strictMode: true,           // Strict validation mode
  
  // Security
  validateOrigin: true,       // Validate request origin
  validateProtocol: true,     // Validate protocol
  enableCORS: false,          // Enable CORS
  corsOrigins: ['*'],         // Allowed origins
  
  // Performance
  maxRequestSize: '10mb',     // Max request body size
  
  // Headers
  defaultResponseHeaders: {
    'X-Powered-By': 'KeypointJS',
    'X-Content-Type-Options': 'nosniff'
  },
  
  // Storage
  keypointStorage: new MemoryKeypointStorage() // Custom storage
});
```

Keypoint Configuration

```javascript
const keypoint = {
  keyId: 'unique_id',          // Required
  secret: 'secure_password',   // Required
  name: 'Production Key',      // Optional
  scopes: ['api:write', 'admin'],
  protocols: ['https', 'wss'], // Allowed protocols
  allowedOrigins: ['https://app.com'],
  allowedIps: ['192.168.1.0/24'],
  rateLimit: {
    requests: 1000,           // Requests per window
    window: 3600             // Seconds (1 hour)
  },
  expiresAt: new Date('2024-12-31'),
  metadata: {
    userId: 'user_123',
    environment: 'production'
  }
};
```

# Plugin System

Built-in Plugins

1. Audit Logger

```javascript
import { AuditLogger } from './plugins/AuditLogger.js';

api.registerPlugin(new AuditLogger({
  logLevel: 'info',
  logToConsole: true,
  logToFile: true,
  filePath: './logs/audit.log',
  maxFileSize: '50mb'
}));
```

2. Rate Limiter

```javascript
import { RateLimiter } from './plugins/RateLimiter.js';

api.registerPlugin(new RateLimiter({
  window: 60000 // 1 minute in milliseconds
}));
```

3. WebSocket Guard

```javascript
import { WebSocketGuard } from './plugins/WebSocketGuard.js';

const wsGuard = api.enableWebSocket({
  path: '/ws',
  requireKeypoint: true,
  pingInterval: 30000,
  maxConnections: 1000
});

wsGuard.onConnection((connection) => {
  console.log('New WebSocket connection:', connection.id);
});

wsGuard.onMessage('chat', (message, connection) => {
  // Handle chat messages
  return { type: 'chat_response', data: 'Message received' };
});
```

Custom Plugin Creation

```javascript
export class CustomPlugin {
  constructor(options = {}) {
    this.name = 'CustomPlugin';
    this.options = options;
  }
  
  async process(ctx, next) {
    const startTime = Date.now();
    const result = await next(ctx);
    const duration = Date.now() - startTime;
    
    ctx.setPluginData(this.name, { duration });
    return result;
  }
  
  initialize() {
    console.log(`${this.name} initialized`);
  }
  
  cleanup() {
    console.log(`${this.name} cleaned up`);
  }
}

// Register custom plugin
api.registerPlugin(new CustomPlugin({ debug: true }));
```

# Security Features

Rate Limiting

```javascript
// Built-in rate limiting rule
api.addPolicyRule(
  BuiltInRules.rateLimitRule(100, 60) // 100 requests per minute
);

// Keypoint-specific rate limiting
const keypoint = new Keypoint({
  keyId: 'limited_key',
  secret: 'secret',
  rateLimit: {
    requests: 50,    // 50 requests
    window: 300      // per 5 minutes
  }
});
```

IP Whitelisting/Blacklisting

```javascript
api.addPolicyRule(
  BuiltInRules.ipRule(
    ['192.168.1.0/24'],  // Allowed IPs
    ['10.0.0.5', '172.16.0.0/12'] // Blocked IPs
  )
);
```

Time-Based Access Control

```javascript
// Only allow access between 9 AM and 5 PM
api.addPolicyRule(
  BuiltInRules.timeWindowRule(9, 17)
);
```

Protocol Enforcement

```javascript
// Only allow HTTPS and WSS protocols
api.addPolicyRule(
  BuiltInRules.protocolRule(['https', 'wss'])
);
```

# WebSocket Support

Setup WebSocket Server

```javascript
// Enable WebSocket support
const wsGuard = api.enableWebSocket({
  path: '/realtime',
  requireKeypoint: true,
  keypointHeader: 'x-keypoint-id'
});

// Handle WebSocket connections
wsGuard.onConnection((connection) => {
  console.log('Connected:', {
    id: connection.id,
    keypointId: connection.keypointId,
    ip: connection.ip
  });
});

// Broadcast messages
wsGuard.broadcast({
  type: 'notification',
  data: 'System update'
}, {
  scope: 'admin' // Only send to admin keypoints
});

// Send to specific connection
wsGuard.sendToConnection('connection_id', {
  type: 'private',
  data: 'Secret message'
});
```

WebSocket Message Handling

```javascript
wsGuard.onMessage('subscribe', async (message, connection) => {
  const { channel } = message;
  
  // Validate subscription rights
  if (channel === 'admin' && !connection.scopes?.includes('admin')) {
    return { type: 'error', error: 'Access denied' };
  }
  
  connection.metadata.subscriptions = 
    connection.metadata.subscriptions || [];
  connection.metadata.subscriptions.push(channel);
  
  return { 
    type: 'subscribed', 
    channel,
    timestamp: new Date().toISOString() 
  };
});
```

# Monitoring & Statistics

Framework Statistics

```javascript
const stats = api.getStats();

console.log('Framework Statistics:', {
  uptime: stats.uptimeFormatted,
  totalRequests: stats.requests,
  successRate: stats.successRate,
  activeKeypoints: stats.keypoints.active,
  totalPlugins: stats.plugins.totalPlugins,
  activeConnections: wsGuard?.getStats()?.totalConnections || 0
});
```

Health Check Endpoint

```javascript
api.get('/health', async (ctx) => {
  const health = await api.healthCheck();
  return ctx.json(health);
});
```

Audit Log Querying

```javascript
const auditLogger = api.pluginManager.getPlugin('AuditLogger');

const logs = await auditLogger.queryLogs({
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  keypointId: 'specific_key',
  level: 'error',
  limit: 100
});
```

# Storage Options

Memory Storage (Default)

```javascript
import { MemoryKeypointStorage } from './keypoint/KeypointStorage.js';

const api = new KeypointJS({
  keypointStorage: new MemoryKeypointStorage()
});
```

# File Storage

```javascript
import { FileKeypointStorage } from './keypoint/KeypointStorage.js';

const api = new KeypointJS({
  keypointStorage: new FileKeypointStorage('./data/keypoints.json')
});
```

# Custom Storage Implementation

```javascript
export class CustomKeypointStorage extends KeypointStorage {
  constructor(databaseClient) {
    super('custom');
    this.db = databaseClient;
  }
  
  async set(keypoint) {
    // Save to database
    await this.db.collection('keypoints').insertOne(keypoint);
    return super.set(keypoint);
  }
  
  async get(keyId) {
    // Try memory cache first
    const cached = super.get(keyId);
    if (cached) return cached;
    
    // Fallback to database
    const doc = await this.db.collection('keypoints').findOne({ keyId });
    if (doc) {
      super.set(doc);
      return doc;
    }
    return null;
  }
}
```

# Testing & Debugging

Error Handling

```javascript
// Global error handler
api.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    console.error('Request failed:', {
      path: ctx.path,
      method: ctx.method,
      keypointId: ctx.getKeypointId(),
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    return ctx.status(error.code || 500).json({
      error: error.message,
      code: error.code,
      requestId: ctx.id
    });
  }
});
```

Debug Middleware

```javascript
api.use(async (ctx, next) => {
  console.log('Incoming request:', {
    id: ctx.id,
    method: ctx.method,
    path: ctx.path,
    ip: ctx.ip,
    keypointId: ctx.getKeypointId()
  });
  
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  
  console.log('Request completed:', {
    id: ctx.id,
    duration: `${duration}ms`,
    status: ctx.response.status
  });
});
```

# Production Deployment

Docker Configuration

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
```

# Environment Configuration

```javascript
const api = new KeypointJS({
  requireKeypoint: process.env.REQUIRE_KEYPOINT !== 'false',
  strictMode: process.env.NODE_ENV === 'production',
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
  enableCORS: process.env.ENABLE_CORS === 'true',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || []
});

// Load keypoints from environment
if (process.env.KEYPOINTS) {
  const keypoints = JSON.parse(process.env.KEYPOINTS);
  for (const kp of keypoints) {
    await api.createKeypoint(kp);
  }
}
```

# Performance Optimization

Connection Pooling

```javascript
// Reuse HTTP agents for better performance
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 1000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 1000
});

// Use in outgoing requests
const response = await fetch(url, {
  agent: url.startsWith('https') ? httpsAgent : httpAgent
});
```

 Caching Strategy

```javascript
import NodeCache from 'node-cache';

const keypointCache = new NodeCache({
  stdTTL: 300, // 5 minutes
  checkperiod: 60
});

// Cache middleware
api.use(async (ctx, next) => {
  if (ctx.method === 'GET') {
    const cacheKey = `${ctx.getKeypointId()}:${ctx.path}`;
    const cached = keypointCache.get(cacheKey);
    
    if (cached) {
      return ctx.json(cached);
    }
    
    await next();
    
    if (ctx.response.status === 200) {
      keypointCache.set(cacheKey, ctx.response.body);
    }
  } else {
    await next();
  }
});
```

# Security Best Practices

- 1. Always use HTTPS in production
- 2. Rotate keypoint secrets regularly (every 90 days)
- 3. Implement IP whitelisting for sensitive endpoints
- 4. Use scope-based authorization instead of role-based
- 5. Enable audit logging for compliance
- 6. Set reasonable rate limits per keypoint
- 7. Validate origins and protocols for each keypoint
- 8. Monitor failed authentication attempts
- 9. Clean up expired keypoints regularly
- 10. Use secure secret storage (not plaintext in code)

# Contributing

### To contribute to KeypointJS:

- 1. Fork the repository
- 2. Create a feature branch (git checkout -b feature/amazing-feature)
- 3. Add tests for your changes
- 4. Ensure all tests pass (npm test)
- 5. Commit your changes (git commit -m 'Add amazing feature')
- 6. Push to the branch (git push origin feature/amazing-feature)
- 7. Open a Pull Request

# License

Apache-2.0 license - see the LICENSE file for details.

# Support

- Documentation: Full API documentation in source code
- Issues: Report bugs via GitHub issues
- Contributions: PRs welcome for bug fixes and features
- Questions: Open a discussion for usage questions

## KeypointJS is Independent

KeypointJS does not depend on Express, Fastify, or any third-party HTTP framework.
It ships with its own HTTP server, routing system, middleware pipeline, and security layer.

## Created Base ♥️ KeypointJS
### AnasBex - (⁠づ⁠￣⁠ ⁠³⁠￣⁠)⁠づ 

KeypointJS provides a comprehensive, layered approach to API security with extensibility through plugins, real-time capabilities via WebSocket, and detailed monitoring through audit logging. The framework is production-ready with built-in security features and can be extended to meet specific requirements.