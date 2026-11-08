import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { ProtocolEngine } from '../src/core/ProtocolEngine.js';
import { BaseProtocolEngine } from '../src/core/BPE.js';
import { Keypoint } from '../src/keypoint/Keypoint.js';
import { KeypointValidator } from '../src/keypoint/KeypointValidator.js';
import { FileKeypointStorage, MemoryKeypointStorage } from '../src/keypoint/KeypointStorage.js';
import { PluginManager } from '../src/core/PluginManager.js';
import { AuditLogger } from '../src/plugins/AuditLogger.js';
import { HttpEngine } from '../src/core/HttpEngine.js';
import { ScopeManager } from '../src/keypoint/ScopeManager.js';
import { KeypointContext } from '../src/keypoint/KeypointContext.js';
import { PolicyEngine } from '../src/policy/PolicyEngine.js';

describe('confirmed audit findings: regression coverage', () => {
  it('resolves direct, inherited, nested, any, all, wildcard, and cyclic scopes', () => {
    const manager = new ScopeManager();
    manager.defineScope('team:admin', 'Team administrator');
    manager.defineScope('team:write', 'Team writer');
    manager.defineScope('team:read', 'Team reader');
    manager.addInheritance('team:admin', ['team:write', 'team:read']);
    manager.addInheritance('team:write', ['team:read']);
    manager.addInheritance('team:read', ['team:admin']);

    assert.equal(manager.hasScope(['team:admin'], 'team:admin'), true);
    assert.equal(manager.hasScope(['team:admin'], 'team:write'), true);
    assert.equal(manager.hasScope(['team:admin'], 'team:read'), true);
    assert.equal(manager.hasScope(['team:admin'], 'unregistered'), false);
    assert.equal(manager.hasAnyScope(['team:admin'], ['missing', 'team:read']), true);
    assert.equal(manager.hasAllScopes(['team:admin'], ['team:write', 'team:read']), true);
    assert.equal(manager.hasAllScopes(['team:admin'], ['team:write', 'missing']), false);
    assert.equal(manager.hasScope(['*'], 'unregistered'), true);
    assert.equal(manager.hasScope(['admin'], 'unregistered'), false);
    assert.deepEqual(manager.getInheritedScopes('team:admin').sort(), ['team:admin', 'team:read', 'team:write']);
  });

  it('uses its ScopeManager for context checks and preserves the no-manager fallback', () => {
    const manager = new ScopeManager();
    manager.defineScope('project:admin', 'Project administrator');
    manager.defineScope('project:write', 'Project writer');
    manager.defineScope('project:read', 'Project reader');
    manager.addInheritance('project:admin', ['project:write']);
    manager.addInheritance('project:write', ['project:read']);
    const keypoint = new Keypoint({ keyId: 'scope-context', secret: 'secret', scopes: ['project:admin'] });
    const request = { headers: {}, url: new URL('http://localhost/') };
    const context = new KeypointContext(request, manager);
    context.keypoint = keypoint;

    assert.equal(context.hasScope('project:write'), true);
    assert.equal(context.hasAnyScope(['missing', 'project:read']), true);
    assert.equal(context.hasAllScopes(['project:write', 'project:read']), true);

    const fallback = new KeypointContext(request);
    fallback.keypoint = keypoint;
    assert.equal(fallback.hasScope('project:admin'), true);
    assert.equal(fallback.hasScope('project:write'), false);
  });

  it('applies registered scope inheritance to PolicyEngine scope policies', async () => {
    const manager = new ScopeManager();
    manager.defineScope('billing:admin', 'Billing administrator');
    manager.defineScope('billing:write', 'Billing writer');
    manager.addInheritance('billing:admin', ['billing:write']);
    const context = new KeypointContext(
      { headers: {}, url: new URL('http://localhost/'), method: 'GET' },
      manager
    );
    context.keypoint = new Keypoint({ keyId: 'billing-admin', secret: 'secret', scopes: ['billing:admin'] });
    const engine = new PolicyEngine();

    assert.deepEqual(await engine.allow({ scope: 'billing:write' })(context), { allowed: true });
    assert.equal((await engine.allow({ scope: 'billing:missing' })(context)).allowed, false);
  });

  it('selects the WebSocket engine for a valid upgrade request', async () => {
    const engine = new ProtocolEngine();
    const request = {
      method: 'GET',
      url: '/socket',
      headers: {
        host: 'localhost',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13'
      },
      socket: {}
    };

    const context = await engine.process(request);
    assert.equal(context.protocol, 'ws');
  });

  it('keeps ordinary and encrypted HTTP requests on their matching engines', async () => {
    const engine = new ProtocolEngine();
    const http = await engine.process({ method: 'GET', url: '/', headers: { host: 'localhost' }, socket: {} });
    const https = await engine.process({ method: 'GET', url: '/', headers: { host: 'localhost' }, socket: { encrypted: true } });

    assert.equal(http.protocol, 'http');
    assert.equal(https.protocol, 'https');
  });

  it('routes gRPC requests through the gRPC engine, including HTTP/2 variants', async () => {
    const engine = new ProtocolEngine();
    const request = {
      method: 'POST',
      url: '/example.Service/Call',
      headers: { host: 'localhost', 'content-type': 'application/grpc', te: 'trailers' },
      socket: {}
    };
    const grpc = await engine.process(request);
    const grpcHttp2 = await engine.process({ ...request, socket: { encrypted: true, alpnProtocol: 'h2' } });

    assert.equal(grpc.protocol, 'grpc');
    assert.equal(grpcHttp2.protocol, 'grpc+http2');
    assert.equal(grpcHttp2.metadata.engine, 'grpc');
    assert.equal(grpcHttp2.metadata.secure, true);
  });

  it('allows registered custom engines to detect requests before the HTTP fallback', async () => {
    const engine = new ProtocolEngine({
      protocolEngines: {
        custom: {
          name: 'custom',
          detect: (request) => request.headers['x-custom-protocol'] === 'yes',
          parse: async () => null,
          validate: async () => true
        }
      }
    });
    const context = await engine.process({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost', 'x-custom-protocol': 'yes' },
      socket: {}
    });

    assert.equal(context.protocol, 'custom');
  });

  it('does not trust forwarded client IP headers without a configured proxy', () => {
    const engine = new ProtocolEngine();
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '192.0.2.4' }
    };

    assert.equal(engine.extractIP(request), '192.0.2.4');
  });

  it('uses forwarded client IP only when the direct peer matches a trusted proxy', () => {
    const engine = new ProtocolEngine({ trustedProxies: ['192.0.2.4'] });
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '192.0.2.4' }
    };

    assert.equal(engine.extractIP(request), '203.0.113.9');
  });

  it('honors forwarded protocol from a configured reverse proxy', async () => {
    const engine = new ProtocolEngine({ trustedProxies: ['192.0.2.4'] });
    const context = await engine.process({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost', 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '192.0.2.4' }
    });

    assert.equal(context.protocol, 'https');
  });

  it('matches trusted proxy CIDR ranges without matching neighboring networks', () => {
    const engine = new ProtocolEngine({ trustedProxies: ['192.0.2.0/24'] });

    assert.equal(engine.isTrustedProxy('192.0.2.9'), true);
    assert.equal(engine.isTrustedProxy('192.0.3.9'), false);
  });

  it('currently accepts a keypoint ID without a secret header', async () => {
    const keypoint = new Keypoint({ keyId: 'regression', secret: 'secret' });
    const storage = new MemoryKeypointStorage();
    await storage.set(keypoint);
    const validator = new KeypointValidator(storage);
    const context = { request: { headers: { 'x-keypoint-id': 'regression' } } };

    assert.equal(await validator.validate(context), true);
    assert.equal(context.keypoint, keypoint);
  });

  it('rejects an incorrect keypoint secret with a KeypointError', async () => {
    const keypoint = new Keypoint({ keyId: 'regression', secret: 'secret' });
    const storage = new MemoryKeypointStorage();
    await storage.set(keypoint);
    const validator = new KeypointValidator(storage);
    const context = {
      request: { headers: { 'x-keypoint-id': 'regression', 'x-keypoint-secret': 'wrong' } }
    };

    await assert.rejects(validator.validate(context), { name: 'KeypointError' });
  });

  it('fails with the framework error, rather than a missing-import ReferenceError, for an unknown keypoint', async () => {
    const validator = new KeypointValidator(new MemoryKeypointStorage());
    const context = { request: { headers: {}, query: {} } };

    await assert.rejects(validator.validate(context), { name: 'KeypointError' });
  });

  it('constructs KeypointValidator without an unresolved storage import', () => {
    const validator = new KeypointValidator();
    assert.ok(validator.storage instanceof MemoryKeypointStorage);
  });

  it('creates a base protocol context at runtime', () => {
    const engine = new BaseProtocolEngine();
    assert.ok(engine.createContext({}).id);
  });

  it('loads gRPC engine module successfully', async () => {
    const { GrpcEngine } = await import('../src/core/GrpcEngine.js');
    const engine = new GrpcEngine();
    const payload = Buffer.from('message');
    const frame = Buffer.alloc(5 + payload.length);
    frame.writeUInt8(0, 0);
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);

    assert.deepEqual(engine.decodeGRPCMessage(frame), { raw: payload, length: payload.length });
  });

  it('parses HTTP request bodies through the standalone HTTP engine', async () => {
    const engine = new HttpEngine();
    const request = new EventEmitter();
    request.method = 'POST';
    request.headers = { 'content-type': 'application/json' };

    const parsed = engine.parse(request);
    request.emit('data', Buffer.from('{"ok":true}'));
    request.emit('end');
    assert.deepEqual(await parsed, { ok: true });
  });

  it('does not accept forwarded protocol headers from an untrusted HTTP peer', async () => {
    const engine = new HttpEngine();
    const protocol = await engine.detect({
      headers: { 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '192.0.2.4' }
    });

    assert.equal(protocol, 'http');
  });

  it('returns an HTTP 404 for a route that does not exist', async (t) => {
    let KeypointJS;
    try {
      ({ KeypointJS } = await import('../src/keypointJS.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /ws/.test(error.message)) {
        t.skip('The ws dependency is not installed in this workspace.');
        return;
      }
      throw error;
    }

    const api = new KeypointJS({ requireKeypoint: false, enableAuditLog: false, enableRateLimiter: false });
    const request = new EventEmitter();
    request.method = 'GET';
    request.url = '/no-such-route';
    request.headers = { host: 'localhost' };
    request.socket = { remoteAddress: '127.0.0.1' };
    request.connection = request.socket;

    const response = await api.handleRequest(request, {});
    assert.equal(response.status, 404);
  });

  it('returns 204 and allowed methods for OPTIONS on a registered route', async (t) => {
    const { KeypointJS } = await import('../src/keypointJS.js');
    const api = new KeypointJS({ requireKeypoint: false, enableCORS: false, enableAuditLog: false, enableRateLimiter: false });
    api.get('/resource', (ctx) => ctx.json({ ok: true }));
    const request = new EventEmitter();
    request.method = 'OPTIONS';
    request.url = '/resource';
    request.headers = { host: 'localhost' };
    request.socket = { remoteAddress: '127.0.0.1' };
    request.connection = request.socket;

    const response = await api.handleRequest(request, {});
    assert.equal(response.status, 204);
    assert.match(response.headers.Allow, /GET/);
    assert.match(response.headers.Allow, /OPTIONS/);
  });

  it('returns a successful CORS preflight response with allowed origin headers', async () => {
    const { KeypointJS } = await import('../src/keypointJS.js');
    const api = new KeypointJS({
      requireKeypoint: false,
      enableCORS: true,
      corsOrigins: ['https://client.example'],
      enableAuditLog: false,
      enableRateLimiter: false
    });
    api.get('/resource', (ctx) => ctx.json({ ok: true }));
    const request = new EventEmitter();
    request.method = 'OPTIONS';
    request.url = '/resource';
    request.headers = {
      host: 'localhost',
      origin: 'https://client.example',
      'access-control-request-method': 'GET'
    };
    request.socket = { remoteAddress: '127.0.0.1' };
    request.connection = request.socket;

    const response = await api.handleRequest(request, {});
    assert.equal(response.status, 204);
    assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://client.example');
  });

  it('exposes the detected HTTP protocol to keypoint validation and route handlers', async () => {
    const { KeypointJS } = await import('../src/keypointJS.js');
    const api = new KeypointJS({ enableAuditLog: false, enableRateLimiter: false });
    await api.createKeypoint({ keyId: 'http-client', secret: 'secret', protocols: ['http'] });
    api.get('/protocol', (ctx) => ctx.json({ protocol: ctx.protocol }));

    const request = new EventEmitter();
    request.method = 'GET';
    request.url = '/protocol';
    request.headers = { host: 'localhost', 'x-keypoint-id': 'http-client' };
    request.socket = { remoteAddress: '127.0.0.1' };
    request.connection = request.socket;

    const response = await api.handleRequest(request, {});
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { protocol: 'http' });
  });

  it('preserves plugin options initialized by the plugin constructor', () => {
    const manager = new PluginManager();
    const logger = new AuditLogger({ logLevel: 'debug', logToConsole: false });
    manager.register(logger, { logLevel: 'warn' });

    assert.equal(logger.options.logLevel, 'warn');
    assert.equal(logger.options.logToConsole, false);
  });

  it('preserves configured built-in audit logger options', async (t) => {
    let KeypointJS;
    try {
      ({ KeypointJS } = await import('../src/keypointJS.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /ws/.test(error.message)) {
        t.skip('The ws dependency is not installed in this workspace.');
        return;
      }
      throw error;
    }

    const api = new KeypointJS({ auditToConsole: false, auditFilePath: 'custom-audit.log', enableRateLimiter: false });
    const logger = api.pluginManager.getPlugin('AuditLogger');
    assert.equal(logger.options.logToConsole, false);
    assert.equal(logger.options.filePath, 'custom-audit.log');
  });

  it('finishes file-storage initialization before returning a stored record', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'keypointjs-regression-'));
    try {
      const filePath = path.join(directory, 'keypoints.json');
      await writeFile(filePath, JSON.stringify([
        { keyId: 'persisted', secret: 'secret', scopes: ['read'], protocols: ['https'] }
      ]));

      const storage = new FileKeypointStorage(filePath);
      const record = await storage.get('persisted');
      assert.ok(record);
      assert.equal(typeof record.hasScope, 'function');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores keypoint records with their class methods after file loading', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'keypointjs-regression-'));
    try {
      const filePath = path.join(directory, 'keypoints.json');
      await writeFile(filePath, JSON.stringify([
        { keyId: 'persisted', secret: 'secret', scopes: ['read'], protocols: ['https'] }
      ]));

      const storage = new FileKeypointStorage(filePath);
      await storage.loadFromFile();
      const record = await storage.get('persisted');
      assert.equal(typeof record.hasScope, 'function');
      assert.equal(record.hasScope('read'), true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps storage indexes consistent when a keypoint ID is overwritten', async () => {
    const storage = new MemoryKeypointStorage();
    await storage.set(new Keypoint({ keyId: 'same-id', name: 'old-name', secret: 'old-secret', scopes: ['old-scope'] }));
    await storage.set(new Keypoint({ keyId: 'same-id', name: 'new-name', secret: 'new-secret', scopes: ['new-scope'] }));

    assert.deepEqual(await storage.getByName('old-name'), []);
    assert.deepEqual(await storage.getByScope('old-scope'), []);
    assert.equal(await storage.getBySecret('old-secret'), null);
  });

  it('clears the WebSocket heartbeat interval during cleanup', async (t) => {
    let WebSocketGuard;
    try {
      ({ WebSocketGuard } = await import('../src/plugins/WebSocketGuard.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /ws/.test(error.message)) {
        t.skip('The ws dependency is not installed in this workspace.');
        return;
      }
      throw error;
    }

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervals = [];
    const cleared = [];
    globalThis.setInterval = (callback, delay) => {
      const handle = { callback, delay };
      intervals.push(handle);
      return handle;
    };
    globalThis.clearInterval = (handle) => cleared.push(handle);

    try {
      const guard = new WebSocketGuard();
      guard.wss = { on() {}, close() {} };
      guard.setupWebSocketHandlers({});
      guard.cleanup();
      assert.equal(intervals.length, 1);
      assert.deepEqual(cleared, intervals);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('runs connection and disconnection callbacks once for a normal close', async (t) => {
    let WebSocketGuard;
    try {
      ({ WebSocketGuard } = await import('../src/plugins/WebSocketGuard.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /ws/.test(error.message)) {
        t.skip('The ws dependency is not installed in this workspace.');
        return;
      }
      throw error;
    }

    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = () => ({ mocked: true });
    try {
      const guard = new WebSocketGuard();
      const wss = new EventEmitter();
      wss.close = () => {};
      guard.wss = wss;
      guard.setupWebSocketHandlers({});
      let connectionId;
      const disconnected = [];
      guard.onConnection((connection) => { connectionId = connection.id; });
      guard.onDisconnection((connection) => disconnected.push(connection.id));

      const ws = new EventEmitter();
      ws.send = () => {};
      ws.close = () => ws.emit('close');
      wss.emit('connection', ws, { headers: {}, socket: { remoteAddress: '127.0.0.1' } });
      assert.ok(connectionId);
      assert.equal(guard.connections.size, 1);

      assert.equal(guard.disconnect(connectionId), true);
      assert.equal(guard.connections.size, 0);
      assert.deepEqual(disconnected, [connectionId]);
      guard.cleanup();
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });

  it('enforces the configured WebSocket connection limit', async (t) => {
    let WebSocketGuard;
    try {
      ({ WebSocketGuard } = await import('../src/plugins/WebSocketGuard.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /ws/.test(error.message)) {
        t.skip('The ws dependency is not installed in this workspace.');
        return;
      }
      throw error;
    }

    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = () => ({ mocked: true });
    try {
      const guard = new WebSocketGuard({ maxConnections: 0 });
      const server = createServer();
      guard.attachToServer(server, {});
      const verification = await new Promise((resolve) => {
        guard.wss.options.verifyClient({ req: { headers: {} } }, (accepted, code) => {
          resolve({ accepted, code });
        });
      });

      assert.deepEqual(verification, { accepted: false, code: 503 });
      assert.equal(guard.connections.size, 0);
      guard.cleanup();
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });
});
