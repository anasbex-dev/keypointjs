import crypto from 'crypto';

export class ProtocolEngine {
  constructor(options = {}) {
    this.options = {
      maxBodySize: '1mb',
      parseJSON: true,
      parseForm: true,
      ...options
    };
    
    this.supportedProtocols = new Set(['https', 'wss', 'http']);
  }
  
  async process(request) {
    const context = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      protocol: this.detectProtocol(request),
      request: {
        method: request.method,
        url: new URL(request.url, `http://${request.headers.host}`),
        headers: this.normalizeHeaders(request.headers),
        ip: this.extractIP(request),
        userAgent: request.headers['user-agent'] || '',
        body: null
      },
      metadata: {}
    };
    
    // Parse body based on content-type
    if (this.shouldParseBody(request)) {
      context.request.body = await this.parseRequestBody(request);
    }
    
    // Validate protocol
    if (!this.supportedProtocols.has(context.protocol)) {
      throw new ProtocolError(`Unsupported protocol: ${context.protocol}`);
    }
    
    return context;
  }
  
  detectProtocol(request) {
    const forwardedProto = request.headers['x-forwarded-proto'];
    if (forwardedProto) return forwardedProto;
    
    const isSecure = request.connection?.encrypted || 
                    request.socket?.encrypted ||
                    (request.headers['x-arr-ssl'] !== undefined);
    
    return isSecure ? 'https' : 'http';
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
      let body = '';
      request.on('data', chunk => {
        body += chunk.toString();
        
        // Check size limit
        if (body.length > this.parseSizeLimit()) {
          request.destroy();
          reject(new ProtocolError('Request body too large'));
        }
      });
      
      request.on('end', () => {
        try {
          const contentType = request.headers['content-type'] || '';
          
          if (contentType.includes('application/json')) {
            resolve(JSON.parse(body));
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(body);
            const result = {};
            for (const [key, value] of params) {
              result[key] = value;
            }
            resolve(result);
          } else {
            resolve(body);
          }
        } catch (error) {
          reject(new ProtocolError(`Failed to parse body: ${error.message}`));
        }
      });
      
      request.on('error', reject);
    });
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
  constructor(message, code = 400) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.timestamp = new Date();
  }
}