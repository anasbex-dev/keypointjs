// core/HttpEngine.js

import { BaseProtocolEngine } from './BPE.js';
import crypto from 'crypto';

export class HttpEngine extends BaseProtocolEngine {
  constructor(options = {}) {
    super(options);
    this.protocolName = 'http';
    this.supportedVersions = new Set(['1.0', '1.1', '2.0', '3.0']);
    
    this.options = {
      maxBodySize: '1mb',
      parseJSON: true,
      parseForm: true,
      parseMultipart: false,
      trustedProxies: [],
      maxHeaderSize: 8192,
      ...options
    };
  }
  
  async detect(request) {
    // Your existing protocol detection logic
    const forwardedProto = request.headers['x-forwarded-proto'];
    if (forwardedProto) {
      const clientIP = this.extractIP(request);
      if (this.isTrustedProxy(clientIP)) {
        return forwardedProto.split(',')[0].trim();
      }
    }
    
    // ALPN detection
    const alpnProtocol = request.socket?.alpnProtocol;
    if (alpnProtocol) {
      if (alpnProtocol === 'h2' || alpnProtocol === 'h3') return 'https';
    }
    
    const isSecure = request.connection?.encrypted ||
      request.socket?.encrypted ||
      request.secure ||
      (request.headers['x-arr-ssl'] !== undefined) ||
      (request.headers['x-forwarded-ssl'] === 'on');
    
    return isSecure ? 'https' : 'http';
  }
  
  async parse(request) {
    // Your existing body parsing logic
    // ...
    return parsedBody;
  }
  
  async validate(context) {
    // Validate HTTP-specific rules
    const { method, headers } = context.request;
    
    // Method validation
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(method.toUpperCase())) {
      throw new ProtocolError(`Invalid HTTP method: ${method}`, 400);
    }
    
    // Content-Length validation
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
  
  async process(request) {
    const context = this.createContext(request);
    
    // Detect protocol
    context.protocol = await this.detect(request);
    context.metadata.httpVersion = request.httpVersion;
    
    // Parse request
    context.request.body = await this.parse(request);
    context.metadata.bodyParsed = true;
    
    // Extract info
    context.request.ip = this.extractIP(request);
    context.request.userAgent = request.headers['user-agent'] || '';
    context.request.cookies = this.parseCookies(request.headers.cookie);
    
    // Validate
    await this.validate(context);
    
    // Run protocol-specific middlewares
    await this.runMiddlewares(context);
    
    return context;
  }
  
  // Existing helper methods...
  extractIP(request) { /* ... */ }
  isTrustedProxy(ip) { /* ... */ }
  parseCookies(cookieHeader) { /* ... */ }
  parseSizeLimit() { /* ... */ }
}