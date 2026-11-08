// core/HttpEngine.js

import { BaseProtocolEngine } from './BPE.js';
import { ProtocolError } from './ProtocolEngine.js';
import { BlockList, isIP } from 'node:net';

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
    const headers = request.headers || {};
    const remoteAddress = this.getRemoteAddress(request);
    const forwardedProto = headers['x-forwarded-proto'];
    if (forwardedProto) {
      if (this.isTrustedProxy(remoteAddress)) {
        const protocol = forwardedProto.split(',')[0].trim();
        if (protocol === 'http' || protocol === 'https') return protocol;
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
      (this.isTrustedProxy(remoteAddress) &&
        (headers['x-arr-ssl'] !== undefined || headers['x-forwarded-ssl'] === 'on'));
    
    return isSecure ? 'https' : 'http';
  }
  
  async parse(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalSize = 0;
      const maxBodySize = this.parseSizeLimit();

      request.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > maxBodySize) {
          request.destroy?.();
          reject(new ProtocolError(`Request body too large (max: ${this.options.maxBodySize})`, 413));
          return;
        }
        chunks.push(chunk);
      });

      request.on('error', reject);
      request.on('end', () => {
        try {
          const body = Buffer.concat(chunks);
          const contentType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          const text = body.toString('utf8');

          if (contentType === 'application/json' && this.options.parseJSON) {
            resolve(text.trim() ? JSON.parse(text) : {});
          } else if (contentType === 'application/x-www-form-urlencoded' && this.options.parseForm) {
            const values = new URLSearchParams(text);
            const parsed = {};
            for (const [key, value] of values) {
              if (key in parsed) {
                parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], value] : [parsed[key], value];
              } else {
                parsed[key] = value;
              }
            }
            resolve(parsed);
          } else if (contentType === 'text/plain' || contentType === 'text/html') {
            resolve(text);
          } else {
            resolve(body);
          }
        } catch (error) {
          reject(new ProtocolError(`Failed to parse body: ${error.message}`, 400, {
            contentType: request.headers['content-type']
          }));
        }
      });
    });
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
  
  extractIP(request) {
    const remoteAddress = this.getRemoteAddress(request);
    const headers = request.headers || {};
    if (!this.isTrustedProxy(remoteAddress)) return remoteAddress || '0.0.0.0';

    const forwarded = headers['x-forwarded-for']?.split(',').map((value) => value.trim()).filter(Boolean);
    if (forwarded?.length) {
      let clientAddress = remoteAddress;
      for (let index = forwarded.length - 1; index >= 0 && this.isTrustedProxy(clientAddress); index--) {
        clientAddress = forwarded[index];
      }
      return clientAddress;
    }
    return headers['x-real-ip'] || remoteAddress || '0.0.0.0';
  }

  getRemoteAddress(request) {
    return request.socket?.remoteAddress || request.connection?.remoteAddress ||
      request.connection?.socket?.remoteAddress || '0.0.0.0';
  }

  isTrustedProxy(ip) {
    if (!ip || !Array.isArray(this.options.trustedProxies)) return false;
    return this.options.trustedProxies.some((proxy) =>
      proxy === ip || this.isIPInCIDR(ip, proxy)
    );
  }

  isIPInCIDR(ip, cidr) {
    if (typeof cidr !== 'string' || !cidr.includes('/')) return false;
    const [network, prefixText] = cidr.split('/');
    const family = isIP(network);
    if (!family || isIP(ip) !== family) return false;
    const prefix = Number(prefixText);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return false;
    try {
      const blockList = new BlockList();
      blockList.addSubnet(network, prefix, family === 4 ? 'ipv4' : 'ipv6');
      return blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
    } catch {
      return false;
    }
  }

  parseCookies(cookieHeader) {
    const cookies = {};
    for (const item of (cookieHeader || '').split(';')) {
      const separator = item.indexOf('=');
      if (separator === -1) continue;
      const name = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();
      if (!name) continue;
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
    return cookies;
  }

  parseSizeLimit() {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)\s*$/i.exec(String(this.options.maxBodySize));
    if (!match) return 1024 * 1024;
    const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    return Number(match[1]) * units[match[2].toLowerCase()];
  }
}
