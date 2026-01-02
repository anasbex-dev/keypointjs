export class PolicyRule {
  constructor(name, evaluator, options = {}) {
    this.name = name;
    this.evaluator = evaluator;
    this.options = {
      priority: 0,
      enabled: true,
      description: '',
      ...options
    };
  }
  
  async evaluate(context) {
    if (!this.options.enabled) {
      return { allowed: true, rule: this.name };
    }
    
    try {
      const result = await this.evaluator(context);
      
      return {
        allowed: result.allowed !== false,
        reason: result.reason || '',
        metadata: result.metadata || {},
        rule: this.name,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        allowed: false,
        reason: `Rule evaluation failed: ${error.message}`,
        metadata: { error: error.message },
        rule: this.name,
        timestamp: new Date()
      };
    }
  }
  
  enable() {
    this.options.enabled = true;
    return this;
  }
  
  disable() {
    this.options.enabled = false;
    return this;
  }
  
  setPriority(priority) {
    this.options.priority = priority;
    return this;
  }
}

// Built-in policy rules
export class BuiltInRules {
  static methodRule(allowedMethods = ['GET', 'POST']) {
    return new PolicyRule(
      'method_check',
      async (ctx) => {
        if (!allowedMethods.includes(ctx.method.toUpperCase())) {
          return {
            allowed: false,
            reason: `Method ${ctx.method} not allowed. Allowed: ${allowedMethods.join(', ')}`
          };
        }
        return { allowed: true };
      },
      { description: 'Check HTTP method' }
    );
  }
  
  static originRule(allowedOrigins = []) {
    return new PolicyRule(
      'origin_check',
      async (ctx) => {
        const origin = ctx.getHeader('origin');
        if (!origin) return { allowed: true };
        
        if (allowedOrigins.length === 0) return { allowed: true };
        if (allowedOrigins.includes('*')) return { allowed: true };
        
        if (!allowedOrigins.includes(origin)) {
          return {
            allowed: false,
            reason: `Origin ${origin} not allowed`
          };
        }
        return { allowed: true };
      },
      { description: 'Check request origin' }
    );
  }
  
  static ipRule(allowedIPs = [], blockedIPs = []) {
    return new PolicyRule(
      'ip_check',
      async (ctx) => {
        const ip = ctx.ip;
        
        // Check blocked first
        if (blockedIPs.includes(ip) || this.isIPInRange(ip, blockedIPs)) {
          return {
            allowed: false,
            reason: `IP ${ip} is blocked`
          };
        }
        
        // Check allowed (if specified)
        if (allowedIPs.length > 0) {
          if (!allowedIPs.includes(ip) && !this.isIPInRange(ip, allowedIPs)) {
            return {
              allowed: false,
              reason: `IP ${ip} not allowed`
            };
          }
        }
        
        return { allowed: true };
      },
      { description: 'Check IP address' }
    );
  }
  
  static timeWindowRule(startHour = 0, endHour = 24) {
    return new PolicyRule(
      'time_window',
      async (ctx) => {
        const now = new Date();
        const hour = now.getHours();
        
        if (hour < startHour || hour >= endHour) {
          return {
            allowed: false,
            reason: `Access only allowed between ${startHour}:00 and ${endHour}:00`
          };
        }
        return { allowed: true };
      },
      { description: 'Check time window' }
    );
  }
  
  static rateLimitRule(limit = 100, windowSeconds = 60) {
    const requests = new Map();
    
    return new PolicyRule(
      'rate_limit',
      async (ctx) => {
        const key = ctx.getKeypointId() || ctx.ip;
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - windowSeconds;
        
        // Clean old requests
        const entry = requests.get(key) || { count: 0, timestamps: [] };
        entry.timestamps = entry.timestamps.filter(t => t > windowStart);
        
        // Check limit
        if (entry.timestamps.length >= limit) {
          return {
            allowed: false,
            reason: 'Rate limit exceeded',
            metadata: {
              limit,
              remaining: 0,
              reset: entry.timestamps[0] + windowSeconds
            }
          };
        }
        
        // Add current request
        entry.timestamps.push(now);
        entry.count = entry.timestamps.length;
        requests.set(key, entry);
        
        return {
          allowed: true,
          metadata: {
            limit,
            remaining: limit - entry.count,
            reset: now + windowSeconds
          }
        };
      },
      { description: 'Rate limiting' }
    );
  }
  
  static scopeRule(requiredScope) {
    return new PolicyRule(
      'scope_check',
      async (ctx) => {
        if (!ctx.hasScope(requiredScope)) {
          return {
            allowed: false,
            reason: `Required scope: ${requiredScope}`
          };
        }
        return { allowed: true };
      },
      { description: 'Check keypoint scope' }
    );
  }
  
  static protocolRule(allowedProtocols = ['https']) {
    return new PolicyRule(
      'protocol_check',
      async (ctx) => {
        if (!allowedProtocols.includes(ctx.protocol)) {
          return {
            allowed: false,
            reason: `Protocol ${ctx.protocol} not allowed. Allowed: ${allowedProtocols.join(', ')}`
          };
        }
        return { allowed: true };
      },
      { description: 'Check protocol' }
    );
  }
  
  static isIPInRange(ip, ranges) {
    for (const range of ranges) {
      if (range.includes('/')) {
        // CIDR notation
        if (this.isIPInCIDR(ip, range)) return true;
      } else if (range.includes('-')) {
        // IP range
        if (this.isIPInRangeNotation(ip, range)) return true;
      } else if (ip === range) {
        return true;
      }
    }
    return false;
  }
  
  static isIPInCIDR(ip, cidr) {
    // Simplified CIDR check - in production use a proper library
    const [network, prefix] = cidr.split('/');
    return ip.startsWith(network);
  }
  
  static isIPInRangeNotation(ip, range) {
    const [start, end] = range.split('-');
    return ip >= start && ip <= end;
  }
}