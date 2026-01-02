export class PolicyEngine {
  constructor() {
    this.rules = [];
    this.policies = new Map();
  }
  
  addPolicy(name, policyFn) {
    this.policies.set(name, policyFn);
  }
  
  addRule(rule) {
    this.rules.push(rule);
  }
  
  async evaluate(context) {
    const decision = {
      allowed: false,
      reason: '',
      metadata: {}
    };
    
    // Evaluate all rules
    for (const rule of this.rules) {
      const result = await rule.evaluate(context);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: result.reason || 'Policy violation',
          metadata: result.metadata
        };
      }
    }
    
    // Evaluate specific policies
    if (context.keypoint) {
      const policyName = context.keypoint.metadata.policy;
      if (policyName && this.policies.has(policyName)) {
        const policy = this.policies.get(policyName);
        return await policy(context);
      }
    }
    
    decision.allowed = true;
    return decision;
  }
  
  // Predefined policies
  allow(config) {
    return async (context) => {
      const { keypoint, request } = context;
      
      // Check scope
      if (config.scope) {
        const hasScope = keypoint.hasScope(config.scope);
        if (!hasScope) {
          return {
            allowed: false,
            reason: `Insufficient scope. Required: ${config.scope}`
          };
        }
      }
      
      // Check method
      if (config.method && config.method !== request.method) {
        return {
          allowed: false,
          reason: `Method ${request.method} not allowed`
        };
      }
      
      // Check protocol
      if (config.protocol && !keypoint.validateProtocol(config.protocol)) {
        return {
          allowed: false,
          reason: `Protocol not allowed`
        };
      }
      
      return { allowed: true };
    };
  }
}