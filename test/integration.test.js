import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { KeypointJS } from '../src/keypointJS.js';
import { Keypoint } from '../src/keypoint/Keypoint.js';
import { FileKeypointStorage } from '../src/keypoint/KeypointStorage.js';
import fs from 'fs/promises';
import path from 'path';

describe('KeypointJS Integration Tests', () => {
  let api;
  let testDir;
  
  beforeEach(async () => {
    // Create temp directory for file storage tests
    testDir = path.join(process.cwd(), 'test_temp');
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  describe('File Storage', () => {
    it('should persist keypoints to file', async () => {
      const filePath = path.join(testDir, 'keypoints.json');
      const storage = new FileKeypointStorage(filePath);
      
      const keypoint = new Keypoint({
        keyId: 'file_test_123',
        secret: 'file_secret',
        name: 'File Test',
        scopes: ['api:public']
      });
      
      await storage.set(keypoint);
      
      // Verify file exists and contains data
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(fileContent);
      
      assert(Array.isArray(data));
      assert.strictEqual(data[0].keyId, 'file_test_123');
      assert.strictEqual(data[0].name, 'File Test');
    });
    
    it('should load keypoints from file', async () => {
      const filePath = path.join(testDir, 'keypoints_load.json');
      
      // Create file with test data
      const testData = [{
        keyId: 'load_test_123',
        secret: 'load_secret',
        name: 'Load Test',
        scopes: ['api:public'],
        protocols: ['https'],
        allowedOrigins: ['*'],
        rateLimit: { requests: 100, window: 60 },
        expiresAt: null,
        createdAt: new Date().toISOString()
      }];
      
      await fs.writeFile(filePath, JSON.stringify(testData));
      
      const storage = new FileKeypointStorage(filePath);
      
      // Should load from file
      const keypoint = await storage.get('load_test_123');
      assert.strictEqual(keypoint.keyId, 'load_test_123');
      assert.strictEqual(keypoint.name, 'Load Test');
    });
  });
  
  describe('Complex Policy Rules', () => {
    it('should combine multiple policy rules', async () => {
      api = new KeypointJS({
        requireKeypoint: true,
        strictMode: false
      });
      
      const { BuiltInRules } = await import('../src/policy/PolicyRule.js');
      
      // Add multiple rules
      api.addPolicyRule(BuiltInRules.methodRule(['GET', 'POST']));
      api.addPolicyRule(BuiltInRules.timeWindowRule(9, 17)); // 9 AM to 5 PM
      api.addPolicyRule(BuiltInRules.ipRule(['127.0.0.1'], []));
      
      const testKeypoint = new Keypoint({
        keyId: 'policy_test',
        secret: 'policy_secret',
        scopes: ['api:public']
      });
      
      await api.keypointStorage.set(testKeypoint);
      
      api.get('/test/policy', (ctx) => {
        return ctx.json({ message: 'Policy test passed' });
      });
      
      const server = api.createServer();
      await new Promise((resolve) => {
        server.listen(0, 'localhost', () => resolve());
      });
      
      const port = server.address().port;
      
      // Test during allowed time (mocked)
      const originalDate = Date;
      global.Date = class extends Date {
        getHours() { return 12; } // 12 PM
      };
      
      try {
        const response = await fetch(`http://localhost:${port}/test/policy`, {
          headers: { 'X-Keypoint-ID': testKeypoint.keyId }
        });
        
        // Should be allowed
        assert.strictEqual(response.status, 200);
      } finally {
        global.Date = originalDate;
        server.close();
      }
    });
  });
  
  describe('Scope Inheritance', () => {
    it('should handle scope inheritance correctly', async () => {
      api = new KeypointJS({
        requireKeypoint: true
      });
      
      // Define scope hierarchy
      api.scopeManager.defineScope('admin', 'Administrator access');
      api.scopeManager.defineScope('write', 'Write access');
      api.scopeManager.defineScope('read', 'Read access');
      
      api.scopeManager.addInheritance('admin', ['read', 'write']);
      api.scopeManager.addInheritance('write', ['read']);
      
      const adminKeypoint = new Keypoint({
        keyId: 'admin_inherit',
        secret: 'admin_secret',
        scopes: ['admin']
      });
      
      await api.keypointStorage.set(adminKeypoint);
      
      // Test scope checks
      api.get('/test/scopes', (ctx) => {
        const hasAdmin = ctx.hasScope('admin');
        const hasWrite = ctx.hasScope('write');
        const hasRead = ctx.hasScope('read');
        const hasNonexistent = ctx.hasScope('nonexistent');
        
        return ctx.json({
          hasAdmin,
          hasWrite,
          hasRead,
          hasNonexistent
        });
      });
      
      const server = api.createServer();
      await new Promise((resolve) => {
        server.listen(0, 'localhost', () => resolve());
      });
      
      const port = server.address().port;
      
      const response = await fetch(`http://localhost:${port}/test/scopes`, {
        headers: { 'X-Keypoint-ID': adminKeypoint.keyId }
      });
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      // Admin should inherit write and read
      assert.strictEqual(data.hasAdmin, true);
      assert.strictEqual(data.hasWrite, true);
      assert.strictEqual(data.hasRead, true);
      assert.strictEqual(data.hasNonexistent, false);
      
      server.close();
    });
  });
});