import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { KeypointJS } from '../src/keypointJS.js';
import { Keypoint } from '../src/keypoint/Keypoint.js';
import http from 'node:http';

describe('KeypointJS Performance Tests', () => {
  let api;
  let server;
  let baseUrl;
  let testKeypoint;
  
  before(async () => {
    api = new KeypointJS({
      requireKeypoint: true,
      strictMode: false
    });
    
    // Create test keypoint
    testKeypoint = new Keypoint({
      keyId: 'perf_test',
      secret: 'perf_secret',
      scopes: ['api:public'],
      rateLimit: { requests: 10000, window: 1 }
    });
    
    await api.keypointStorage.set(testKeypoint);
    
    // Simple echo endpoint
    api.get('/perf/echo', (ctx) => {
      return ctx.json({
        timestamp: new Date().toISOString(),
        keypointId: ctx.getKeypointId()
      });
    });
    
    // Health check endpoint (no authentication required)
    api.get('/perf/health', (ctx) => {
      return ctx.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    // Start server
    server = api.createServer();
    await new Promise((resolve) => {
      server.listen(0, 'localhost', () => {
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });
  
  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  
  it('should handle multiple sequential requests', async () => {
    const numRequests = 100;
    const startTime = Date.now();
    const results = [];
    
    for (let i = 0; i < numRequests; i++) {
      const result = await makeRequest(`${baseUrl}/perf/echo`, {
        'X-Keypoint-ID': testKeypoint.keyId
      });
      results.push(result);
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / numRequests;
    const reqPerSec = (numRequests / totalTime) * 1000;
    
    console.log(`\nSequential Test Results:`);
    console.log(`Total requests: ${numRequests}`);
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Average time per request: ${avgTime.toFixed(2)}ms`);
    console.log(`Requests per second: ${reqPerSec.toFixed(2)}`);
    
    // Verify all requests succeeded
    const successCount = results.filter(r => r.status === 200).length;
    assert.strictEqual(successCount, numRequests, 'All requests should succeed');
    
    assert(reqPerSec > 50, `Should handle >50 req/sec, got ${reqPerSec.toFixed(2)}`);
  });
  
  it('should handle concurrent requests', async () => {
    const numConcurrent = 10;
    const requestsPerBatch = 5;
    const startTime = Date.now();
    
    const batches = [];
    for (let i = 0; i < numConcurrent; i++) {
      const batch = [];
      for (let j = 0; j < requestsPerBatch; j++) {
        batch.push(makeRequest(`${baseUrl}/perf/echo`, {
          'X-Keypoint-ID': testKeypoint.keyId
        }));
      }
      batches.push(Promise.all(batch));
    }
    
    const results = await Promise.all(batches);
    const totalTime = Date.now() - startTime;
    const totalRequests = numConcurrent * requestsPerBatch;
    const reqPerSec = (totalRequests / totalTime) * 1000;
    
    console.log(`\nConcurrent Test Results:`);
    console.log(`Concurrent batches: ${numConcurrent}`);
    console.log(`Requests per batch: ${requestsPerBatch}`);
    console.log(`Total requests: ${totalRequests}`);
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Requests per second: ${reqPerSec.toFixed(2)}`);
    
    const successCount = results.flat().filter(r => r.status === 200).length;
    assert.strictEqual(successCount, totalRequests, 'All concurrent requests should succeed');
    
    assert(reqPerSec > 100, `Should handle >100 req/sec with concurrency, got ${reqPerSec.toFixed(2)}`);
  });
  
  it('should handle health checks without authentication', async () => {
    const numRequests = 50;
    const startTime = Date.now();
    const promises = [];
    
    for (let i = 0; i < numRequests; i++) {
      promises.push(makeRequest(`${baseUrl}/perf/health`, {}));
    }
    
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    const reqPerSec = (numRequests / totalTime) * 1000;
    
    console.log(`\nHealth Check Test Results:`);
    console.log(`Total health checks: ${numRequests}`);
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Requests per second: ${reqPerSec.toFixed(2)}`);
    
    const successCount = results.filter(r => r.status === 200).length;
    assert.strictEqual(successCount, numRequests, 'All health checks should succeed');
  });
  
  it('should handle mixed request types', async () => {
    const testCases = [
      { path: '/perf/echo', requiresAuth: true },
      { path: '/perf/health', requiresAuth: false }
    ];
    
    const results = [];
    const startTime = Date.now();
    
    for (let i = 0; i < 30; i++) {
      for (const testCase of testCases) {
        const headers = testCase.requiresAuth ?
          { 'X-Keypoint-ID': testKeypoint.keyId } :
          {};
        
        results.push(
          makeRequest(`${baseUrl}${testCase.path}`, headers)
        );
      }
    }
    
    const allResults = await Promise.all(results);
    const totalTime = Date.now() - startTime;
    
    const successCount = allResults.filter(r => r.status === 200).length;
    const errorCount = allResults.filter(r => r.status !== 200).length;
    
    console.log(`\nMixed Request Test Results:`);
    console.log(`Total requests: ${allResults.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total time: ${totalTime}ms`);
    
    assert.strictEqual(errorCount, 0, 'Should have no errors in mixed requests');
  });
});

// Helper function to make HTTP requests
function makeRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'KeypointJS-Performance-Test',
        ...headers
      }
    };
    
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data,
            headers: res.headers
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        status: 0,
        error: err.message
      });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({
        status: 0,
        error: 'Request timeout'
      });
    });
    
    req.end();
  });
}