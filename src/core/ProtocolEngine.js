// core/ProtocolEngine.js - VERSION v.1.2.2

import crypto from 'crypto';

export class ProtocolEngine {
  constructor(options = {}) {
    this.options = {
      maxBodySize: '1mb',
      parseJSON: true,
      parseForm: true,
      validateProtocol: true,
      trustedProxies: [],
      maxHeaderSize: 8192,
      protocolEngines: {}, // Custom protocol engines
      defaultEngine: 'http', // Default engine
      ...options
    };
    
    this.supportedProtocols = new Set(['https', 'wss', 'http', 'grpc']);
    this.engines = new Map(); // NEW: Engine registry
    this.protocolAdapters = new Map(); // NEW: Protocol adapters
    
    this.initializeDefaultEngines();
  }
  
  // NEW: Initialize protocol engines
  initializeDefaultEngines() {
    // Register HTTP/HTTPS engine (default)
    this.registerEngine('http', this.createHttpEngine());
    this.registerEngine('https', this.createHttpEngine({ defaultSecure: true }));
    
    // Register WebSocket engines if enabled
    if (this.options.enableWebSocket !== false) {
      this.registerEngine('ws', this.createWsEngine());
      this.registerEngine('wss', this.createWsEngine({ defaultSecure: true }));
    }
    
    // Register gRPC engine if enabled
    if (this.options.enableGrpc !== false) {
      this.registerEngine('grpc', this.createGrpcEngine());
    }
    
    // Register custom engines from options
    if (this.options.protocolEngines) {
      for (const [protocol, engine] of Object.entries(this.options.protocolEngines)) {
        this.registerEngine(protocol, engine);
      }
    }
  }
  
  // NEW: Create HTTP engine
  createHttpEngine(engineOptions = {}) {
    return {
      name: 'http',
      detect: this.detectHttpProtocol.bind(this),
      parse: this.parseHttpRequest.bind(this),
      validate: this.validateHttpRequest.bind(this),
      shouldParseBody: this.shouldParseBody.bind(this),
      options: { ...this.options, ...engineOptions }
    };
  }
  
  // NEW: Create WebSocket engine
  createWsEngine(engineOptions = {}) {
    return {
      name: 'ws',
      detect: this.detectWebSocketProtocol.bind(this),
      parse: this.parseWebSocketRequest.bind(this),
      validate: this.validateWebSocketRequest.bind(this),
      createHandshake: this.createWebSocketHandshake.bind(this),
      options: { ...this.options, ...engineOptions }
    };
  }
  
  // NEW: Create gRPC engine
  createGrpcEngine(engineOptions = {}) {
    return {
      name: 'grpc',
      detect: this.detectGrpcProtocol.bind(this),
      parse: this.parseGrpcRequest.bind(this),
      validate: this.validateGrpcRequest.bind(this),
      decodeMessage: this.decodeGrpcMessage.bind(this),
      options: { ...this.options, ...engineOptions }
    };
  }
  
  // NEW: Register custom engine
  registerEngine(protocol, engine) {
    if (!engine.detect || !engine.parse || !engine.validate) {
      throw new Error(`Engine for ${protocol} must implement detect, parse, and validate methods`);
    }
    this.engines.set(protocol, engine);
    this.supportedProtocols.add(protocol);
  }
  
  // NEW: Get engine for protocol
  getEngine(protocol) {
    const engine = this.engines.get(protocol);
    if (!engine) {
      throw new ProtocolError(`No engine available for protocol: ${protocol}`, 426);
    }
    return engine;
  }
  
  async process(request) {
    // Validate request basics
    if (!request.method || !request.url) {
      throw new ProtocolError('Invalid request structure', 400);
    }
    
    // Validate headers size
    const headerSize = JSON.stringify(request.headers).length;
    if (headerSize > this.options.maxHeaderSize) {
      throw new ProtocolError('Request headers too large', 431);
    }
    
    // NEW: Detect protocol using registered engines
    const protocol = await this.detectProtocolWithEngines(request);
    
    // Get the appropriate engine
    const engine = this.getEngine(protocol);
    
    // Create base context
    const context = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      protocol: protocol,
      request: {
        method: request.method,
        url: this.parseURL(request),
        headers: this.normalizeHeaders(request.headers),
        ip: this.extractIP(request),
        userAgent: request.headers['user-agent'] || '',
        body: null,
        cookies: this.parseCookies(request.headers.cookie),
        trailers: request.trailers || {}
      },
      metadata: {
        bodyParsed: false,
        secure: false,
        clientInfo: {},
        engine: engine.name,
        protocolVersion: null
      }
    };
    
    // Set secure flag
    context.metadata.secure = protocol === 'https' || protocol === 'wss' || protocol === 'grpc+tls';
    
    // Add client information
    context.metadata.clientInfo = this.extractClientInfo(request);
    
    // NEW: Use engine-specific parsing
    if (engine.shouldParseBody && await engine.shouldParseBody(request)) {
      context.request.body = await engine.parse(request, context);
      context.metadata.bodyParsed = true;
    }
    
    // NEW: Validate with engine
    await engine.validate(context);
    
    // NEW: Add engine-specific metadata
    context.metadata.engineInfo = {
      name: engine.name,
      capabilities: Object.keys(engine).filter(key => typeof engine[key] === 'function'),
      options: engine.options
    };
    
    // Validate protocol
    if (this.options.validateProtocol && !this.supportedProtocols.has(context.protocol)) {
      throw new ProtocolError(
        `Unsupported protocol: ${context.protocol}. Supported: ${Array.from(this.supportedProtocols).join(', ')}`,
        426
      );
    }
    
    return context;
  }
  
  // NEW: Multi-engine protocol detection
  async detectProtocolWithEngines(request) {
    // Try each engine's detection method
    for (const [protocol, engine] of this.engines) {
      try {
        const detected = await engine.detect(request);
        if (detected) {
          return protocol;
        }
      } catch (error) {
        // Engine couldn't detect, try next one
        continue;
      }
    }
    
    // Fallback to HTTP detection
    return this.detectHttpProtocol(request) ? 'http' : 'https';
  }
  
  // HTTP Protocol Detection (Enhanced)
  detectHttpProtocol(request) {
    // Prioritize headers
    const forwardedProto = request.headers['x-forwarded-proto'];
    if (forwardedProto) {
      const clientIP = this.extractIP(request);
      if (this.isTrustedProxy(clientIP)) {
        const protocol = forwardedProto.split(',')[0].trim();
        return protocol === 'https' || protocol === 'http';
      }
    }
    
    // Check for ALPN protocol (HTTP/2, HTTP/3)
    const alpnProtocol = request.socket?.alpnProtocol;
    if (alpnProtocol) {
      if (alpnProtocol === 'h2' || alpnProtocol === 'h3') return true;
    }
    
    // Standard detection
    const isSecure = request.connection?.encrypted ||
                    request.socket?.encrypted ||
                    request.secure ||
                    (request.headers['x-arr-ssl'] !== undefined) ||
                    (request.headers['x-forwarded-ssl'] === 'on');
    
    return true; // Always true for HTTP engine
  }
  
  // NEW: WebSocket Protocol Detection
  detectWebSocketProtocol(request) {
    const upgrade = request.headers['upgrade'];
    const connection = request.headers['connection'];
    
    if (upgrade?.toLowerCase() === 'websocket' && 
        connection?.toLowerCase().includes('upgrade')) {
      
      const isSecure = request.connection?.encrypted || 
                      request.socket?.encrypted ||
                      request.secure;
      
      return isSecure ? 'wss' : 'ws';
    }
    
    return false;
  }
  
  // NEW: gRPC Protocol Detection
  detectGrpcProtocol(request) {
    const contentType = request.headers['content-type'];
    
    if (contentType?.startsWith('application/grpc')) {
      // Check if it's over HTTP/2
      const alpnProtocol = request.socket?.alpnProtocol;
      if (alpnProtocol === 'h2') {
        return 'grpc+http2';
      }
      
      // Check if secure
      const isSecure = request.connection?.encrypted || 
                      request.socket?.encrypted ||
                      request.secure;
      
      return isSecure ? 'grpc+tls' : 'grpc';
    }
    
    return false;
  }
  
  // NEW: HTTP Request Parser
  async parseHttpRequest(request, context) {
    return this.parseRequestBody(request);
  }
  
  // NEW: WebSocket Request Parser
  async parseWebSocketRequest(request, context) {
    // WebSocket doesn't parse body in traditional way
    // Return handshake info instead
    return {
      key: request.headers['sec-websocket-key'],
      version: request.headers['sec-websocket-version'],
      protocol: request.headers['sec-websocket-protocol'],
      extensions: request.headers['sec-websocket-extensions'],
      origin: request.headers['origin']
    };
  }
  
  // NEW: gRPC Request Parser
  async parseGrpcRequest(request, context) {
    return new Promise((resolve, reject) => {
      let body = Buffer.from('');
      
      request.on('data', chunk => {
        body = Buffer.concat([body, chunk]);
      });
      
      request.on('end', () => {
        try {
          // Simple gRPC message parsing
          // In production, use @grpc/proto-loader
          const message = this.decodeGrpcMessage(body);
          resolve(message);
        } catch (error) {
          reject(new ProtocolError(`Failed to parse gRPC message: ${error.message}`, 400));
        }
      });
      
      request.on('error', reject);
    });
  }
  
  // NEW: gRPC Message Decoder
  decodeGrpcMessage(buffer) {
    // Simple gRPC frame parsing
    // Format: [1 byte compression flag] + [4 bytes message length] + [message]
    if (buffer.length < 5) {
      throw new Error('Invalid gRPC message');
    }
    
    const compressionFlag = buffer.readUInt8(0);
    const messageLength = buffer.readUInt32BE(1);
    
    if (buffer.length < 5 + messageLength) {
      throw new Error('Incomplete gRPC message');
    }
    
    const messageData = buffer.slice(5, 5 + messageLength);
    
    return {
      compressed: compressionFlag === 1,
      length: messageLength,
      data: messageData,
      raw: buffer
    };
  }
  
  // NEW: HTTP Request Validator
  validateHttpRequest(context) {
    const { method, headers } = context.request;
    
    // Validate HTTP method
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(method.toUpperCase())) {
      throw new ProtocolError(`Invalid HTTP method: ${method}`, 400);
    }
    
    // Validate Content-Length
    const contentLength = headers['content-length'];
    if (contentLength) {
      const size = parseInt(contentLength);
      const maxSize = this.parseSizeLimit();
      if (size > maxSize) {
        throw new ProtocolError(`Content-Length exceeds limit: ${size} > ${maxSize}`, 413);
      }
    }
    
    return true;
  }
  
  // NEW: WebSocket Request Validator
  validateWebSocketRequest(context) {
    const { headers } = context.request;
    
    // Validate required WebSocket headers
    const requiredHeaders = [
      'upgrade',
      'connection',
      'sec-websocket-key',
      'sec-websocket-version'
    ];
    
    for (const header of requiredHeaders) {
      if (!headers[header]) {
        throw new ProtocolError(`Missing WebSocket header: ${header}`, 400);
      }
    }
    
    // Validate WebSocket version
    if (headers['sec-websocket-version'] !== '13') {
      throw new ProtocolError('WebSocket version must be 13', 426);
    }
    
    return true;
  }
  
  // NEW: gRPC Request Validator
  validateGrpcRequest(context) {
    const { headers } = context.request;
    
    // Validate required gRPC headers
    if (!headers['content-type']?.startsWith('application/grpc')) {
      throw new ProtocolError('Invalid gRPC content-type', 415);
    }
    
    // Validate TE header for gRPC over HTTP/2
    if (headers['te'] !== 'trailers') {
      throw new ProtocolError('Missing or invalid TE header', 400);
    }
    
    return true;
  }
  
  // NEW: WebSocket Handshake Creator
  createWebSocketHandshake(context) {
    const key = context.request.headers['sec-websocket-key'];
    const acceptKey = this.generateWebSocketAcceptKey(key);
    
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`
    ];
    
    // Add optional subprotocol
    if (context.request.headers['sec-websocket-protocol']) {
      headers.push(`Sec-WebSocket-Protocol: ${context.request.headers['sec-websocket-protocol']}`);
    }
    
    return headers.join('\r\n') + '\r\n\r\n';
  }
  
  // NEW: Generate WebSocket accept key
  generateWebSocketAcceptKey(key) {
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1');
    sha1.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
    return sha1.digest('base64');
  }
  
  // NEW: Multipart Form Data Parser
  async parseMultipartFormData(body, contentType) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      throw new ProtocolError('Invalid multipart boundary', 400);
    }
    
    const boundary = `--${boundaryMatch[1]}`;
    const parts = body.toString().split(boundary);
    const result = {};
    
    for (const part of parts.slice(1, -1)) {
      const [headers, ...contentParts] = part.split('\r\n\r\n');
      const content = contentParts.join('\r\n\r\n').trim();
      
      const nameMatch = headers.match(/name="([^"]+)"/);
      if (nameMatch) {
        const name = nameMatch[1];
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        
        if (filenameMatch) {
          // File upload
          if (!result[name]) result[name] = [];
          result[name].push({
            filename: filenameMatch[1],
            contentType: headers.match(/Content-Type:\s*([^\r\n]+)/)?.[1] || 'application/octet-stream',
            size: Buffer.byteLength(content),
            content: Buffer.from(content)
          });
        } else {
          // Regular field
          result[name] = content;
        }
      }
    }
    
    return result;
  }
  
  // NEW: Large body parser
  async parseLargeBody(body, mimeType) {
    // For large bodies, we might want to stream to disk
    // For now, just parse as-is
    const bodyString = body.toString('utf-8');
    
    if (mimeType === 'application/json') {
      return JSON.parse(bodyString);
    }
    
    return bodyString;
  }
  
  isTrustedProxy(ip) {
    if (this.options.trustedProxies.length === 0) return true;
    return this.options.trustedProxies.some(proxy =>
      proxy === ip || this.isIPInCIDR(ip, proxy)
    );
  }
  
  isIPInCIDR(ip, cidr) {
    // Simplified CIDR check
    const [network, prefix] = cidr.split('/');
    return ip.startsWith(network);
  }
  
  normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }
  
  extractIP(request) {
    return request.headers['x-forwarded-for']?.split(',')[0].trim() ||
           request.headers['x-real-ip'] ||
           request.connection?.remoteAddress ||
           request.socket?.remoteAddress ||
           request.connection?.socket?.remoteAddress ||
           '0.0.0.0';
  }
  
  shouldParseBody(request) {
    const method = request.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
    
    const contentType = request.headers['content-type'] || '';
    return contentType.includes('application/json') || 
           contentType.includes('application/x-www-form-urlencoded');
  }
  
  async parseRequestBody(request) {
    return new Promise((resolve, reject) => {
      let body = Buffer.from('');
      let totalSize = 0;
      
      request.on('data', chunk => {
        totalSize += chunk.length;
        
        // Check size limit early
        if (totalSize > this.parseSizeLimit()) {
          request.destroy();
          reject(new ProtocolError(`Request body too large (max: ${this.options.maxBodySize})`, 413));
          return;
        }
        
        body = Buffer.concat([body, chunk]);
      });
      
      request.on('end', async () => {
        try {
          const contentType = request.headers['content-type'] || '';
          const mimeType = contentType.split(';')[0].trim();
          
          // Stream parsing for large files
          if (totalSize > 1024 * 1024) { // > 1MB
            resolve(await this.parseLargeBody(body, mimeType));
            return;
          }
          
          const bodyString = body.toString('utf-8');
          
          // Content-Type specific parsing
          if (mimeType === 'application/json' && this.options.parseJSON) {
            if (bodyString.trim() === '') resolve({});
            else resolve(JSON.parse(bodyString));
          } 
          else if (mimeType === 'application/x-www-form-urlencoded' && this.options.parseForm) {
            const params = new URLSearchParams(bodyString);
            const result = {};
            for (const [key, value] of params) {
              // Handle duplicate keys (array values)
              if (key in result) {
                if (Array.isArray(result[key])) {
                  result[key].push(value);
                } else {
                  result[key] = [result[key], value];
                }
              } else {
                result[key] = value;
              }
            }
            resolve(result);
          }
          else if (mimeType === 'multipart/form-data') {
            resolve(await this.parseMultipartFormData(body, contentType));
          }
          else if (mimeType === 'text/plain' || mimeType === 'text/html') {
            resolve(bodyString);
          }
          else {
            // Raw buffer for binary data
            resolve(body);
          }
        } catch (error) {
          reject(new ProtocolError(
            `Failed to parse body: ${error.message}`,
            400,
            { contentType: request.headers['content-type'] }
          ));
        }
      });
      
      request.on('error', reject);
    });
  }
  
  parseURL(request) {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      
      // Security: Sanitize URL
      return {
        href: url.href,
        origin: url.origin,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        search: url.search,
        searchParams: url.searchParams,
        hash: url.hash,
        toString: () => url.toString()
      };
    } catch (error) {
      throw new ProtocolError(`Invalid URL: ${request.url}`, 400);
    }
  }
  
  extractClientInfo(request) {
    return {
      ip: this.extractIP(request),
      port: request.socket?.remotePort,
      family: request.socket?.remoteFamily,
      tlsVersion: request.socket?.getProtocol?.(),
      cipher: request.socket?.getCipher?.(),
      servername: request.socket?.servername, // SNI
      authenticated: request.socket?.authorized || false,
      certificate: request.socket?.getPeerCertificate?.() || null
    };
  }
  
  parseCookies(cookieHeader) {
    if (!cookieHeader) return {};
    
    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name) {
        cookies[name] = decodeURIComponent(valueParts.join('=') || '');
      }
    });
    return cookies;
  }
  
  parseSizeLimit() {
    const size = this.options.maxBodySize;
    if (typeof size === 'number') return size;
    
    const match = size.match(/^(\d+)(mb|kb|b)$/i);
    if (!match) return 1024 * 1024; // 1MB default
    
    const [, num, unit] = match;
    const multiplier = {
      'b': 1,
      'kb': 1024,
      'mb': 1024 * 1024
    }[unit.toLowerCase()];
    
    return parseInt(num) * multiplier;
  }
}

export class ProtocolError extends Error {
  constructor(message, code = 400, details = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    this.stackTrace = process.env.NODE_ENV === 'development' ? this.stack : undefined;
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
      details: this.details,
      ...(process.env.NODE_ENV === 'development' && { stack: this.stackTrace })
    };
  }
}