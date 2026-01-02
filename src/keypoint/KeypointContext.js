import { Context } from '../core/Context.js';

export class KeypointContext extends Context {
  constructor(request) {
    super(request);
    this.keypoint = null;
    this.scopes = [];
    this.rateLimit = null;
    this.accessLog = [];
  }
  
  // Keypoint-specific methods
  hasScope(scope) {
    if (!this.keypoint) return false;
    return this.keypoint.hasScope(scope);
  }
  
  hasAnyScope(scopes) {
    if (!this.keypoint) return false;
    return scopes.some(scope => this.keypoint.hasScope(scope));
  }
  
  hasAllScopes(scopes) {
    if (!this.keypoint) return false;
    return scopes.every(scope => this.keypoint.hasScope(scope));
  }
  
  getKeypointId() {
    return this.keypoint?.keyId;
  }
  
  getKeypointMetadata() {
    return this.keypoint?.metadata || {};
  }
  
  // Rate limit info
  getRateLimitInfo() {
    if (!this.keypoint) return null;
    
    return {
      limit: this.keypoint.rateLimit.requests,
      window: this.keypoint.rateLimit.window,
      remaining: this.rateLimit?.remaining || this.keypoint.rateLimit.requests
    };
  }
  
  // Audit logging
  logAccess(action, details = {}) {
    this.accessLog.push({
      timestamp: new Date(),
      action,
      keypointId: this.getKeypointId(),
      ip: this.ip,
      method: this.method,
      path: this.path,
      ...details
    });
  }
  
  // Security validation
  validateOrigin() {
    if (!this.keypoint) return false;
    
    const origin = this.getHeader('origin') || this.getHeader('referer');
    if (!origin) return true; // No origin to validate
    
    return this.keypoint.validateOrigin(origin);
  }
  
  validateProtocol() {
    if (!this.keypoint) return false;
    return this.keypoint.validateProtocol(this.protocol);
  }
  
  // Convenience getters
  get isAuthenticated() {
    return !!this.keypoint;
  }
  
  get isExpired() {
    return this.keypoint?.isExpired() || false;
  }
  
  get allowedMethods() {
    const policy = this.keypoint?.metadata?.allowedMethods;
    return policy || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  }
}