// Import http module once at top level
let http;
try {
  http = await import('http');
} catch (error) {
  console.error('Failed to import http module:', error);
}

import { Context } from './core/Context.js';
import { ProtocolEngine, ProtocolError } from './core/ProtocolEngine.js';
import { Keypoint } from './keypoint/Keypoint.js';
import { KeypointContext } from './keypoint/KeypointContext.js';
import { KeypointValidator } from './keypoint/KeypointValidator.js';
import { MemoryKeypointStorage } from './keypoint/KeypointStorage.js';
import { ScopeManager } from './keypoint/ScopeManager.js';
import { PolicyEngine } from './policy/PolicyEngine.js';
import { BuiltInRules } from './policy/PolicyRule.js';
import { MinimalRouter } from './router/MinimalRouter.js';
import { PluginManager, BuiltInHooks } from './plugins/PluginManager.js';
import { RateLimiter } from './plugins/RateLimiter.js';
import { AuditLogger } from './plugins/AuditLogger.js';
import { WebSocketGuard } from './plugins/WebSocketGuard.js';

export class KeypointJS {
  constructor(options = {}) {
    this.options = {
      requireKeypoint: true,
      strictMode: true,
      validateOrigin: true,
      validateProtocol: true,
      enableCORS: false,
      corsOrigins: ['*'],
      maxRequestSize: '10mb',
      defaultResponseHeaders: {
        'X-Powered-By': 'KeypointJS',
        'X-Content-Type-Options': 'nosniff'
      },
      errorHandler: this.defaultErrorHandler.bind(this),
      ...options
    };
    
    // Initialize core components
    this.initializeCore();
    
    // Initialize layers
    this.initializeLayers();
    
    // Setup built-in policies
    this.setupBuiltInPolicies();
    
    // Event emitter
    this.events = new Map();
    
    // Statistics
    this.stats = {
      requests: 0,
      successful: 0,
      failed: 0,
      keypointValidations: 0,
      policyChecks: 0,
      startTime: new Date()
    };
  }
  
  initializeCore() {
    // Core protocol engine
    this.protocolEngine = new ProtocolEngine({
      maxBodySize: this.options.maxRequestSize,
      parseJSON: true,
      parseForm: true
    });
    
    // Keypoint system
    this.keypointStorage = this.options.keypointStorage || new MemoryKeypointStorage();
    this.scopeManager = new ScopeManager();
    this.keypointValidator = new KeypointValidator(this.keypointStorage);
    
    // Policy engine
    this.policyEngine = new PolicyEngine();
    
    // Router
    this.router = new MinimalRouter();
    
    // Plugin manager
    this.pluginManager = new PluginManager();
    
    // Middleware chain
    this.middlewareChain = [];
    
    // WebSocket support
    this.wsGuard = null;
  }
  
  initializeLayers() {
    // Layer 0: Pre-processing (hooks)
    this.use(async (ctx, next) => {
      await this.pluginManager.runHook(BuiltInHooks.BEFORE_KEYPOINT_VALIDATION, ctx);
      return next(ctx);
    });
    
// Layer 1: Protocol Engine
this.use(async (ctx, next) => {
  try {
    const processed = await this.protocolEngine.process(ctx.request);
    
    ctx.id = processed.id;
    ctx.timestamp = processed.timestamp;
    ctx.metadata = processed.metadata;
    
    // Update request object
    if (processed.request) {
      ctx.request = {
        ...ctx.request,
        ...processed.request
      };
    }
    
    ctx.setState('_protocol', processed.protocol);
    ctx.setState('_ip', processed.request?.ip);
    
  } catch (error) {
    throw new KeypointError(`Protocol error: ${error.message}`, 400);
  }
  return next(ctx);
});
    
    // Layer 2: CORS (if enabled)
    if (this.options.enableCORS) {
      this.use(this.corsMiddleware.bind(this));
    }
    
    // Layer 3: Keypoint Validation (if required)
    if (this.options.requireKeypoint) {
      this.use(async (ctx, next) => {
        await this.pluginManager.runHook(BuiltInHooks.BEFORE_KEYPOINT_VALIDATION, ctx);
        
        try {
          const isValid = await this.keypointValidator.validate(ctx);
          if (!isValid) {
            throw new KeypointError('Invalid or missing keypoint', 401);
          }
          
          this.stats.keypointValidations++;
          
          // Validate origin if configured
          if (this.options.validateOrigin && !ctx.validateOrigin()) {
            throw new KeypointError('Origin not allowed for this keypoint', 403);
          }
          
          // Validate protocol if configured
          if (this.options.validateProtocol && !ctx.validateProtocol()) {
            throw new KeypointError('Protocol not allowed for this keypoint', 403);
          }
          
          await this.pluginManager.runHook(BuiltInHooks.AFTER_KEYPOINT_VALIDATION, ctx);
        } catch (error) {
          await this.pluginManager.runHook(BuiltInHooks.ON_ERROR, ctx, error);
          throw error;
        }
        
        return next(ctx);
      });
    }
    
    // Layer 4: Policy Check
    this.use(async (ctx, next) => {
      await this.pluginManager.runHook(BuiltInHooks.BEFORE_POLICY_CHECK, ctx);
      
      try {
        const decision = await this.policyEngine.evaluate(ctx);
        if (!decision.allowed) {
          throw new PolicyError(decision.reason, 403, decision);
        }
        
        ctx.policyDecision = decision;
        this.stats.policyChecks++;
        
        await this.pluginManager.runHook(BuiltInHooks.AFTER_POLICY_CHECK, ctx, decision);
      } catch (error) {
        await this.pluginManager.runHook(BuiltInHooks.ON_ERROR, ctx, error);
        throw error;
      }
      
      return next(ctx);
    });
    
    // Layer 5: Plugin Processing
    this.use(async (ctx, next) => {
      return this.pluginManager.process(ctx, next);
    });
    
    // Layer 6: Route Execution
    this.use(async (ctx, next) => {
      await this.pluginManager.runHook(BuiltInHooks.BEFORE_ROUTE_EXECUTION, ctx);
      
      try {
        await this.router.handle(ctx);
        
        await this.pluginManager.runHook(BuiltInHooks.AFTER_ROUTE_EXECUTION, ctx);
      } catch (error) {
        await this.pluginManager.runHook(BuiltInHooks.ON_ERROR, ctx, error);
        throw error;
      }
      
      return next(ctx);
    });
    
    // Layer 7: Response Processing
    this.use(async (ctx, next) => {
      await this.pluginManager.runHook(BuiltInHooks.BEFORE_RESPONSE, ctx);
      
      // Apply default headers
      if (ctx.response) {
        ctx.response.headers = {
          ...this.options.defaultResponseHeaders,
          ...ctx.response.headers
        };
        
        // Add security headers
        ctx.response.headers['X-Keypoint-ID'] = ctx.getKeypointId() || 'none';
        ctx.response.headers['X-Policy-Decision'] = ctx.policyDecision?.allowed ? 'allowed' : 'denied';
        
        // Add CORS headers if enabled
        if (this.options.enableCORS) {
          this.addCORSHeaders(ctx);
        }
      }
      
      await this.pluginManager.runHook(BuiltInHooks.AFTER_RESPONSE, ctx);
      
      return next(ctx);
    });
  }
  
  setupBuiltInPolicies() {
    // Add rate limiting policy
    const rateLimitRule = BuiltInRules.rateLimitRule(100, 60);
    this.policyEngine.addRule(rateLimitRule);
    
    // Add method validation policy
    const methodRule = BuiltInRules.methodRule(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);
    this.policyEngine.addRule(methodRule);
    
    // Add built-in policy templates
    this.policyEngine.addPolicy('public', this.policyEngine.allow({
      scope: 'api:public',
      protocol: 'https'
    }));
    
    this.policyEngine.addPolicy('admin', this.policyEngine.allow({
      scope: 'admin',
      protocol: 'https'
    }));
    
    this.policyEngine.addPolicy('internal', this.policyEngine.allow({
      scope: 'api:internal',
      protocol: ['https', 'wss']
    }));
  }
  
  corsMiddleware(ctx, next) {
    const origin = ctx.getHeader('origin');
    
    if (origin) {
      // Check if origin is allowed
      const isAllowed = this.options.corsOrigins.includes('*') || 
                       this.options.corsOrigins.includes(origin);
      
      if (isAllowed) {
        ctx.response.headers = {
          ...ctx.response.headers,
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Keypoint-ID, X-Keypoint-Secret'
        };
      }
    }
    
    // Handle preflight requests
    if (ctx.method === 'OPTIONS') {
      ctx.response = {
        status: 204,
        headers: ctx.response.headers
      };
      return;
    }
    
    return next(ctx);
  }
  
  addCORSHeaders(ctx) {
    if (!this.options.enableCORS) return;
    
    const origin = ctx.getHeader('origin');
    if (origin && (this.options.corsOrigins.includes('*') || this.options.corsOrigins.includes(origin))) {
      ctx.response.headers = {
        ...ctx.response.headers,
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'X-Keypoint-ID, X-Policy-Decision'
      };
    }
  }
  
  // Public API Methods
  
  use(middleware) {
    this.middlewareChain.push(middleware);
    return this;
  }
  
  route(method, path, handler) {
    this.router.route(method, path, handler);
    return this;
  }
  
  get(path, handler) {
    return this.route('GET', path, handler);
  }
  
  post(path, handler) {
    return this.route('POST', path, handler);
  }
  
  put(path, handler) {
    return this.route('PUT', path, handler);
  }
  
  delete(path, handler) {
    return this.route('DELETE', path, handler);
  }
  
  patch(path, handler) {
    return this.route('PATCH', path, handler);
  }
  
  options(path, handler) {
    return this.route('OPTIONS', path, handler);
  }
  
  // Plugin management
  
  registerPlugin(plugin, options = {}) {
    this.pluginManager.register(plugin, options);
    
    // Special handling for WebSocketGuard
    if (plugin instanceof WebSocketGuard) {
      this.wsGuard = plugin;
    }
    
    return this;
  }
  
  enableWebSocket(options = {}) {
    if (!this.wsGuard) {
      const wsGuard = new WebSocketGuard(options);
      this.registerPlugin(wsGuard);
    }
    return this.wsGuard;
  }
  
  // Keypoint management
  
  async createKeypoint(data) {
    const Keypoint = (await import('./keypoint/Keypoint.js')).Keypoint;
    const keypoint = new Keypoint(data);
    await this.keypointStorage.set(keypoint);
    
    this.emit('keypoint:created', { keypoint });
    return keypoint;
  }
  
  async revokeKeypoint(keyId) {
    const keypoint = await this.keypointStorage.get(keyId);
    if (keypoint) {
      await this.keypointStorage.delete(keyId);
      this.emit('keypoint:revoked', { keyId, keypoint });
      return true;
    }
    return false;
  }
  
  async listKeypoints(filter = {}) {
    return await this.keypointStorage.list(filter);
  }
  
  async getKeypoint(keyId) {
    return await this.keypointStorage.get(keyId);
  }
  
  // Policy management
  
  addPolicyRule(rule) {
    this.policyEngine.addRule(rule);
    return this;
  }
  
  addPolicy(name, policyFn) {
    this.policyEngine.addPolicy(name, policyFn);
    return this;
  }
  
  // Scope management
  
  defineScope(name, description, metadata = {}) {
    this.scopeManager.defineScope(name, description, metadata);
    return this;
  }
  
  // Request handling
  
  async handleRequest(request, response) {
    const ctx = new KeypointContext(request);
    this.stats.requests++;
    
    try {
      await this.runMiddlewareChain(ctx);
      this.stats.successful++;
      
      this.emit('request:success', {
        ctx,
        timestamp: new Date(),
        duration: ctx.response?.duration || 0
      });
      
      return ctx.response;
    } catch (error) {
      this.stats.failed++;
      
      this.emit('request:error', {
        ctx,
        error,
        timestamp: new Date()
      });
      
      return this.options.errorHandler(error, ctx, response);
    }
  }
  
  async runMiddlewareChain(ctx, index = 0) {
    if (index >= this.middlewareChain.length) return;
    
    const middleware = this.middlewareChain[index];
    const next = () => this.runMiddlewareChain(ctx, index + 1);
    
    return await middleware(ctx, next);
  }
  
// HTTP Server integration
createServer() {
  if (!http) {
    throw new Error('HTTP module not available');
  }
  
  const server = http.createServer(async (req, res) => {
    const response = await this.handleRequest(req, res);
    
    res.statusCode = response.status || 200;
    Object.entries(response.headers || {}).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    
    if (response.body !== undefined) {
      const body = typeof response.body === 'string' ?
        response.body :
        JSON.stringify(response.body);
      res.end(body);
    } else {
      res.end();
    }
  });
  
  if (this.wsGuard) {
    this.wsGuard.attachToServer(server, this);
  }
  
  return server;
}

listen(port, hostname = '0.0.0.0', callback) {
  const server = this.createServer();
  
  server.listen(port, hostname, () => {
    const address = server.address();
    console.log(`
 KeypointJS Server Started
════════════════════════════════════════
 Address: ${hostname}:${port}
 Mode: ${this.options.requireKeypoint ? 'Strict (Keypoint Required)' : 'Permissive'}
 Protocols: HTTP/HTTPS${this.wsGuard ? ' + WebSocket' : ''}
 Plugins: ${this.pluginManager.getPluginNames().length} loaded
 Keypoints: ${this.keypointStorage.store.size} registered
════════════════════════════════════════
    `);
    
    if (callback) callback(server);
  });
  
  return server;
}

async listen(port, hostname = '0.0.0.0', callback) {
  const server = await this.createServer();
  
  server.listen(port, hostname, () => {
    const address = server.address();
    console.log(`
 KeypointJS Server Started
════════════════════════════════════════
 Address: ${hostname}:${port}
 Mode: ${this.options.requireKeypoint ? 'Strict (Keypoint Required)' : 'Permissive'}
 Protocols: HTTP/HTTPS${this.wsGuard ? ' + WebSocket' : ''}
 Plugins: ${this.pluginManager.getPluginNames().length} loaded
 Keypoints: ${this.keypointStorage.store.size} registered
════════════════════════════════════════
    `);
    
    if (callback) callback(server);
  });
  
  return server;
}
  
  listen(port, hostname = '0.0.0.0', callback) {
    const server = this.createServer();
    
    server.listen(port, hostname, () => {
      const address = server.address();
      console.log(`
 KeypointJS Server Started
════════════════════════════════════════
 Address: ${hostname}:${port}
 Mode: ${this.options.requireKeypoint ? 'Strict (Keypoint Required)' : 'Permissive'}
 Protocols: HTTP/HTTPS${this.wsGuard ? ' + WebSocket' : ''}
 Plugins: ${this.pluginManager.getPluginNames().length} loaded
 Keypoints: ${this.keypointStorage.store.size} registered
════════════════════════════════════════
      `);
      
      if (callback) callback(server);
    });
    
    return server;
  }
  
  // Error handling
  
  defaultErrorHandler(error, ctx, response) {
    const status = error.code || 500;
    const message = error.message || 'Internal Server Error';
    
    if (this.options.strictMode) {
      // Hide internal error details in production
      const safeMessage = status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : message;
      
      return {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...this.options.defaultResponseHeaders
        },
        body: {
          error: safeMessage,
          code: status,
          timestamp: new Date().toISOString(),
          requestId: ctx?.id
        }
      };
    }
    
    return {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...this.options.defaultResponseHeaders
      },
      body: {
        error: message,
        code: status,
        timestamp: new Date().toISOString(),
        requestId: ctx?.id,
        details: error.details || {},
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };
  }
  
  // Event system
  
  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(handler);
    return this;
  }
  
  off(event, handler) {
    if (!this.events.has(event)) return this;
    
    const handlers = this.events.get(event);
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
    return this;
  }
  
  emit(event, data) {
    if (!this.events.has(event)) return;
    
    for (const handler of this.events.get(event)) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }
  
  // Statistics
  
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    
    return {
      ...this.stats,
      uptime,
      uptimeFormatted: this.formatUptime(uptime),
      successRate: this.stats.requests > 0 
        ? (this.stats.successful / this.stats.requests * 100).toFixed(2) + '%'
        : '0%',
      plugins: this.pluginManager.getStats(),
      keypoints: {
        total: this.keypointStorage.store.size,
        expired: (async () => {
          const all = await this.keypointStorage.list();
          return all.filter(k => k.isExpired()).length;
        })(),
        active: (async () => {
          const all = await this.keypointStorage.list();
          return all.filter(k => !k.isExpired()).length;
        })()
      },
      routes: this.router.routes.size,
      policies: this.policyEngine.rules.length
    };
  }
  
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
  }
  
  // Health check
  
  async healthCheck() {
    const checks = {
      keypointStorage: this.keypointStorage instanceof MemoryKeypointStorage ? 'memory' : 'connected',
      pluginManager: 'ok',
      policyEngine: 'ok',
      router: 'ok',
      uptime: this.getStats().uptimeFormatted
    };
    
    // Check storage connectivity if not memory
    if (!(this.keypointStorage instanceof MemoryKeypointStorage)) {
      try {
        await this.keypointStorage.count();
        checks.keypointStorage = 'connected';
      } catch (error) {
        checks.keypointStorage = 'disconnected';
        checks.error = error.message;
      }
    }
    
    const allOk = Object.values(checks).every(v => v !== 'disconnected');
    
    return {
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks
    };
  }
  
  // Configuration
  
  configure(options) {
    this.options = { ...this.options, ...options };
    return this;
  }
  
  // Shutdown
  
  async shutdown() {
    console.log('Shutting down KeypointJS...');
    
    // Shutdown plugins
    await this.pluginManager.shutdown();
    
    // Close WebSocket connections
    if (this.wsGuard) {
      this.wsGuard.cleanup();
    }
    
    // Emit shutdown event
    this.emit('shutdown', {
      timestamp: new Date(),
      stats: this.getStats()
    });
    
    console.log('KeypointJS shutdown complete');
  }
}

// Custom Error Classes

export class KeypointError extends Error {
  constructor(message, code = 401, details = {}) {
    super(message);
    this.name = 'KeypointError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

export class PolicyError extends Error {
  constructor(message, code = 403, decision = null) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.decision = decision;
    this.timestamp = new Date();
  }
}

export class ValidationError extends Error {
  constructor(message, code = 400, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.errors = errors;
    this.timestamp = new Date();
  }
}

// Export utilities

export {
  Context,
  ProtocolEngine,
  Keypoint,
  KeypointContext,
  KeypointValidator,
  MemoryKeypointStorage,
  ScopeManager,
  PolicyEngine,
  BuiltInRules,
  MinimalRouter,
  PluginManager,
  BuiltInHooks,
  RateLimiter,
  AuditLogger,
  WebSocketGuard
};