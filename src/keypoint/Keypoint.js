export class Keypoint {
  constructor(data) {
    this.keyId = data.keyId;
    this.secret = data.secret;
    this.name = data.name || '';
    this.scopes = data.scopes || [];
    this.protocols = data.protocols || ['https'];
    this.allowedOrigins = data.allowedOrigins || [];
    this.allowedIps = data.allowedIps || [];
    this.rateLimit = data.rateLimit || {
      requests: 100,
      window: 60 // seconds
    };
    this.expiresAt = data.expiresAt || null;
    this.createdAt = data.createdAt || new Date();
    this.metadata = data.metadata || {};
  }
  
  hasScope(requiredScope) {
    return this.scopes.includes('*') || this.scopes.includes(requiredScope);
  }
  
  isExpired() {
    return this.expiresAt && new Date() > this.expiresAt;
  }
  
  validateOrigin(origin) {
    if (this.allowedOrigins.length === 0) return true;
    return this.allowedOrigins.includes('*') || 
           this.allowedOrigins.includes(origin);
  }
  
  validateProtocol(protocol) {
    return this.protocols.includes(protocol);
  }
}