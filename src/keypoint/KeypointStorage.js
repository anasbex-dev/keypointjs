import { Keypoint } from './Keypoint.js';

export class KeypointStorage {
  constructor(driver = 'memory') {
    this.driver = driver;
    this.store = new Map();
    this.indexes = {
      bySecret: new Map(),
      byName: new Map(),
      byScope: new Map()
    };
  }
  
  async set(keypoint) {
    if (!keypoint.keyId) {
      throw new Error('Keypoint must have keyId');
    }
    
    const existing = this.store.get(keypoint.keyId);
    if (existing) await this.removeIndexes(existing);
    this.store.set(keypoint.keyId, keypoint);
    
    // Update indexes
    if (keypoint.secret) {
      this.indexes.bySecret.set(keypoint.secret, keypoint.keyId);
    }
    
    if (keypoint.name) {
      if (!this.indexes.byName.has(keypoint.name)) {
        this.indexes.byName.set(keypoint.name, new Set());
      }
      this.indexes.byName.get(keypoint.name).add(keypoint.keyId);
    }
    
    // Index by scopes
    for (const scope of keypoint.scopes) {
      if (!this.indexes.byScope.has(scope)) {
        this.indexes.byScope.set(scope, new Set());
      }
      this.indexes.byScope.get(scope).add(keypoint.keyId);
    }
    
    return true;
  }
  
  async get(keyId) {
    return this.store.get(keyId) || null;
  }
  
  async getBySecret(secret) {
    const keyId = this.indexes.bySecret.get(secret);
    return keyId ? await this.get(keyId) : null;
  }
  
  async getByName(name) {
    const keyIds = this.indexes.byName.get(name);
    if (!keyIds) return [];
    
    const results = [];
    for (const keyId of keyIds) {
      const keypoint = await this.get(keyId);
      if (keypoint) results.push(keypoint);
    }
    return results;
  }
  
  async getByScope(scope) {
    const keyIds = this.indexes.byScope.get(scope);
    if (!keyIds) return [];
    
    const results = [];
    for (const keyId of keyIds) {
      const keypoint = await this.get(keyId);
      if (keypoint) results.push(keypoint);
    }
    return results;
  }
  
  async update(keyId, updates) {
    const existing = await this.get(keyId);
    if (!existing) return false;
    
    // Remove old indexes
    await this.removeIndexes(existing);
    
    // Apply updates
    const updated = Object.assign(Object.create(Object.getPrototypeOf(existing)), existing, {
      ...existing,
      ...updates,
      updatedAt: new Date()
    });
    
    // Save updated keypoint
    await this.set(updated);
    return true;
  }
  
  async delete(keyId) {
    const keypoint = await this.get(keyId);
    if (!keypoint) return false;
    
    // Remove indexes
    await this.removeIndexes(keypoint);
    
    // Remove from store
    return this.store.delete(keyId);
  }
  
  async removeIndexes(keypoint) {
    // Remove from secret index
    if (keypoint.secret && this.indexes.bySecret.get(keypoint.secret) === keypoint.keyId) {
      this.indexes.bySecret.delete(keypoint.secret);
    }
    
    // Remove from name index
    if (keypoint.name) {
      const nameSet = this.indexes.byName.get(keypoint.name);
      if (nameSet) {
        nameSet.delete(keypoint.keyId);
        if (nameSet.size === 0) {
          this.indexes.byName.delete(keypoint.name);
        }
      }
    }
    
    // Remove from scope indexes
    for (const scope of keypoint.scopes) {
      const scopeSet = this.indexes.byScope.get(scope);
      if (scopeSet) {
        scopeSet.delete(keypoint.keyId);
        if (scopeSet.size === 0) {
          this.indexes.byScope.delete(scope);
        }
      }
    }
  }
  
  async list(filter = {}) {
    const results = [];
    
    for (const keypoint of this.store.values()) {
      let match = true;
      
      // Apply filters
      if (filter.scope && !keypoint.hasScope(filter.scope)) {
        match = false;
      }
      
      if (filter.protocol && !keypoint.protocols.includes(filter.protocol)) {
        match = false;
      }
      
      if (filter.expired !== undefined) {
        const isExpired = keypoint.isExpired();
        if (filter.expired !== isExpired) {
          match = false;
        }
      }
      
      if (filter.name && keypoint.name !== filter.name) {
        match = false;
      }
      
      if (match) {
        results.push(keypoint);
      }
    }
    
    return results;
  }
  
  async count() {
    return this.store.size;
  }
  
  async cleanupExpired() {
    const expired = [];
    
    for (const [keyId, keypoint] of this.store) {
      if (keypoint.isExpired()) {
        expired.push(keyId);
      }
    }
    
    for (const keyId of expired) {
      await this.delete(keyId);
    }
    
    return expired.length;
  }
}

// Memory storage implementation (default)
export class MemoryKeypointStorage extends KeypointStorage {
  constructor() {
    super('memory');
  }
}

// File storage implementation
export class FileKeypointStorage extends KeypointStorage {
  constructor(filePath) {
    super('file');
    this.filePath = filePath;
    this.ready = this.initializeFromFile();
  }
  
  async loadFromFile() {
    return this.ready;
  }

  async initializeFromFile() {
    const fs = await import('fs/promises');
    let data;
    try {
      data = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.saveToFileContents();
      return;
    }

    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) throw new TypeError('Keypoint storage file must contain an array');
    for (const item of parsed) {
      await super.set(new Keypoint(item));
    }
  }
  
  async saveToFile() {
    await this.ready;
    return this.saveToFileContents();
  }

  async saveToFileContents() {
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const data = Array.from(this.store.values());
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  async get(keyId) {
    await this.ready;
    return super.get(keyId);
  }

  async getBySecret(secret) {
    await this.ready;
    return super.getBySecret(secret);
  }

  async getByName(name) {
    await this.ready;
    return super.getByName(name);
  }

  async getByScope(scope) {
    await this.ready;
    return super.getByScope(scope);
  }

  async list(filter = {}) {
    await this.ready;
    return super.list(filter);
  }

  async count() {
    await this.ready;
    return super.count();
  }

  async cleanupExpired() {
    await this.ready;
    return super.cleanupExpired();
  }

  async update(keyId, updates) {
    await this.ready;
    return super.update(keyId, updates);
  }
  
  async set(keypoint) {
    await this.ready;
    await super.set(keypoint);
    await this.saveToFileContents();
    return true;
  }
  
  async delete(keyId) {
    await this.ready;
    const result = await super.delete(keyId);
    if (result) await this.saveToFileContents();
    return result;
  }
}
