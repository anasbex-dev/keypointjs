export class AccessDecision {
  constructor() {
    this.allowed = false;
    this.reason = '';
    this.metadata = {};
    this.violations = [];
    this.timestamp = new Date();
    this.evaluatedRules = [];
  }
  
  static allow(reason = '', metadata = {}) {
    const decision = new AccessDecision();
    decision.allowed = true;
    decision.reason = reason;
    decision.metadata = metadata;
    return decision;
  }
  
  static deny(reason = '', violations = [], metadata = {}) {
    const decision = new AccessDecision();
    decision.allowed = false;
    decision.reason = reason;
    decision.violations = violations;
    decision.metadata = metadata;
    return decision;
  }
  
  addRuleResult(ruleName, result) {
    this.evaluatedRules.push({
      rule: ruleName,
      allowed: result.allowed,
      reason: result.reason,
      timestamp: result.timestamp,
      metadata: result.metadata
    });
    
    if (!result.allowed) {
      this.violations.push({
        rule: ruleName,
        reason: result.reason,
        metadata: result.metadata
      });
    }
  }
  
  merge(otherDecision) {
    // Merge two decisions (for chained evaluations)
    const merged = new AccessDecision();
    merged.allowed = this.allowed && otherDecision.allowed;
    merged.reason = this.allowed ? otherDecision.reason : this.reason;
    merged.metadata = { ...this.metadata, ...otherDecision.metadata };
    merged.violations = [...this.violations, ...otherDecision.violations];
    merged.evaluatedRules = [
      ...this.evaluatedRules,
      ...otherDecision.evaluatedRules
    ];
    
    return merged;
  }
  
  toJSON() {
    return {
      allowed: this.allowed,
      reason: this.reason,
      violations: this.violations,
      metadata: this.metadata,
      timestamp: this.timestamp.toISOString(),
      evaluatedRules: this.evaluatedRules
    };
  }
  
  getSummary() {
    const summary = {
      allowed: this.allowed,
      reason: this.reason,
      ruleCount: this.evaluatedRules.length,
      violationCount: this.violations.length,
      passedRules: this.evaluatedRules.filter(r => r.allowed).length,
      failedRules: this.evaluatedRules.filter(r => !r.allowed).length
    };
    
    if (this.violations.length > 0) {
      summary.violations = this.violations.map(v => ({
        rule: v.rule,
        reason: v.reason
      }));
    }
    
    return summary;
  }
  
  getDebugInfo() {
    return {
      decision: this.toJSON(),
      context: {
        ip: this.metadata.ip,
        method: this.metadata.method,
        path: this.metadata.path,
        keypointId: this.metadata.keypointId,
        scopes: this.metadata.scopes
      }
    };
  }
}