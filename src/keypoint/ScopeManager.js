export class ScopeManager {
  constructor() {
    this.scopeDefinitions = new Map();
    this.scopeHierarchy = new Map();
    this.initializeDefaultScopes();
  }
  
  initializeDefaultScopes() {
    // Built-in scopes
    this.defineScope('*', 'Full access to all resources');
    this.defineScope('read', 'Read-only access');
    this.defineScope('write', 'Read and write access');
    this.defineScope('admin', 'Administrative access');
    
    // API scopes
    this.defineScope('api:public', 'Public API access');
    this.defineScope('api:private', 'Private API access');
    this.defineScope('api:internal', 'Internal API access');
    
    // Resource-specific scopes
    this.defineScope('user:read', 'Read user data');
    this.defineScope('user:write', 'Write user data');
    this.defineScope('post:read', 'Read posts');
    this.defineScope('post:write', 'Write posts');
    
    // Define hierarchy
    this.addInheritance('admin', ['read', 'write', '*']);
    this.addInheritance('write', ['read']);
    this.addInheritance('api:internal', ['api:private', 'api:public']);
  }
  
  defineScope(name, description, metadata = {}) {
    this.scopeDefinitions.set(name, {
      name,
      description,
      metadata,
      createdAt: new Date()
    });
  }
  
  addInheritance(parentScope, childScopes) {
    if (!this.scopeHierarchy.has(parentScope)) {
      this.scopeHierarchy.set(parentScope, new Set());
    }
    
    const parentSet = this.scopeHierarchy.get(parentScope);
    for (const child of childScopes) {
      parentSet.add(child);
    }
  }
  
  validateScope(scope) {
    return this.scopeDefinitions.has(scope);
  }
  
  getScopeDefinition(scope) {
    return this.scopeDefinitions.get(scope) || null;
  }
  
  getInheritedScopes(scope) {
    const inherited = new Set();
    const queue = [scope];
    
    while (queue.length > 0) {
      const current = queue.shift();
      const children = this.scopeHierarchy.get(current);
      
      if (children) {
        for (const child of children) {
          if (!inherited.has(child)) {
            inherited.add(child);
            queue.push(child);
          }
        }
      }
    }
    
    return Array.from(inherited);
  }
  
  hasScope(availableScopes, requiredScope) {
    if (availableScopes.includes('*')) {
      return true;
    }
    
    if (availableScopes.includes(requiredScope)) {
      return true;
    }
    
    // Check inheritance
    const inherited = this.getInheritedScopes(requiredScope);
    return inherited.some(inheritedScope => 
      availableScopes.includes(inheritedScope)
    );
  }
  
  hasAnyScope(availableScopes, requiredScopes) {
    return requiredScopes.some(scope => 
      this.hasScope(availableScopes, scope)
    );
  }
  
  hasAllScopes(availableScopes, requiredScopes) {
    return requiredScopes.every(scope =>
      this.hasScope(availableScopes, scope)
    );
  }
  
  expandScopes(scopes) {
    const expanded = new Set();
    
    for (const scope of scopes) {
      expanded.add(scope);
      
      // Add inherited scopes
      const inherited = this.getInheritedScopes(scope);
      for (const inheritedScope of inherited) {
        expanded.add(inheritedScope);
      }
    }
    
    return Array.from(expanded);
  }
  
  reduceScopes(scopes) {
    const expanded = this.expandScopes(scopes);
    const reduced = new Set();
    
    for (const scope of scopes) {
      // Check if this scope is covered by another scope
      const inherited = this.getInheritedScopes(scope);
      const isCovered = inherited.some(inheritedScope => 
        scope !== inheritedScope && scopes.includes(inheritedScope)
      );
      
      if (!isCovered) {
        reduced.add(scope);
      }
    }
    
    return Array.from(reduced);
  }
  
  validateScopeRequest(requestedScopes, allowedScopes) {
    const invalid = [];
    const denied = [];
    
    for (const scope of requestedScopes) {
      if (!this.validateScope(scope)) {
        invalid.push(scope);
        continue;
      }
      
      if (!this.hasScope(allowedScopes, scope)) {
        denied.push(scope);
      }
    }
    
    return {
      valid: invalid.length === 0 && denied.length === 0,
      invalid,
      denied,
      granted: requestedScopes.filter(scope => 
        !invalid.includes(scope) && !denied.includes(scope)
      )
    };
  }
  
  createScopePattern(pattern) {
    if (pattern === '*') {
      return () => true; // Matches all scopes
    }
    
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return (scope) => regex.test(scope);
    }
    
    return (scope) => scope === pattern;
  }
  
  matchScopes(pattern, scopes) {
    const matcher = this.createScopePattern(pattern);
    return scopes.filter(scope => matcher(scope));
  }
  
  getAllScopes() {
    return Array.from(this.scopeDefinitions.keys());
  }
  
  getScopeTree() {
    const tree = {};
    
    for (const [scope, definition] of this.scopeDefinitions) {
      const inherited = this.getInheritedScopes(scope);
      
      tree[scope] = {
        ...definition,
        inherits: inherited,
        children: Array.from(this.scopeHierarchy.get(scope) || [])
      };
    }
    
    return tree;
  }
}