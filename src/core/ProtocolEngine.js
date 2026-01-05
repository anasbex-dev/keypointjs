import crypto from 'crypto';

export class ProtocolEngine {
  constructor(options = {}) {
    this.options = {
      maxBodySize: '1mb',
      parseJSON: true,
      parseForm: true,
      validateProtocol: true, // protocol validation
      trustedProxies: [], // trusted proxy list
      maxHeaderSize: 8192, // header limits
      ...options
    };
    
    this.supportedProtocols = new Set(['https', 'wss', 'http', 'grpc']); // grpc
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
  
  const context = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    protocol: this.detectProtocol(request),
    request: {
      method: request.method,
      url: this.parseURL(request),
      headers: this.normalizeHeaders(request.headers),
      ip: this.extractIP(request),
      userAgent: request.headers['user-agent'] || '',
      body: null,
      cookies: this.parseCookies(request.headers.cookie), // cookies
      trailers: request.trailers || {} // trailers
    },
    metadata: {
      bodyParsed: false,
      secure: false,
      clientInfo: {}
    }
  };
  
  // Set secure flag
  context.metadata.secure = context.protocol === 'https' || context.protocol === 'wss';
  
  // Add client information
  context.metadata.clientInfo = this.extractClientInfo(request);
  
  // Parse body if needed
  if (this.shouldParseBody(request)) {
    context.request.body = await this.parseRequestBody(request);
    context.metadata.bodyParsed = true;
  }
  
  // Validate protocol
  if (this.options.validateProtocol && !this.supportedProtocols.has(context.protocol)) {
    throw new ProtocolError(
      `Unsupported protocol: ${context.protocol}. Supported: ${Array.from(this.supportedProtocols).join(', ')}`,
      426 // Upgrade Required
    );
  }
  
  return context;
}
  
  detectProtocol(request) {
  // Prioritize headers
  const forwardedProto = request.headers['x-forwarded-proto'];
  if (forwardedProto) {
    // Security: Validate against trusted proxies
    const clientIP = this.extractIP(request);
    if (this.isTrustedProxy(clientIP)) {
      return forwardedProto.split(',')[0].trim();
    }
  }
  
  // Check for ALPN protocol (HTTP/2, HTTP/3)
  const alpnProtocol = request.socket?.alpnProtocol;
  if (alpnProtocol) {
    if (alpnProtocol === 'h2') return 'https';
    if (alpnProtocol === 'h3') return 'https';
  }
  
  // Standard detection
  const isSecure = request.connection?.encrypted ||
    request.socket?.encrypted ||
    request.secure ||
    (request.headers['x-arr-ssl'] !== undefined) ||
    (request.headers['x-forwarded-ssl'] === 'on');
  
  return isSecure ? 'https' : 'http';
}

isTrustedProxy(ip) {
  if (this.options.trustedProxies.length === 0) return true;
  return this.options.trustedProxies.some(proxy =>
    proxy === ip || this.isIPInCIDR(ip, proxy)
  );
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
          // Raw buffer untuk binary data
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