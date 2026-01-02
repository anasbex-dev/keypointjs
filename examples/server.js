console.log('KeypointJS Server - Starting...');
console.log('==================================');

// Import framework dengan error handling
try {
  // Dynamic import untuk handle ES modules
  const framework = await import('../src/keypointJS.js');
  const { KeypointJS, Keypoint } = framework;
  
  console.log('Framework loaded successfully');
  
  // Create instance with SIMPLE config first
  const api = new KeypointJS({
    requireKeypoint: false, // DISABLE untuk testing dulu
    strictMode: false, // DISABLE untuk melihat error detail
    enableCORS: true,
    corsOrigins: ['*'],
    maxRequestSize: '10mb'
  });
  
  console.log('KeypointJS instance created');
  
  // Create test keypoint
  const testKeypoint = new Keypoint({
    keyId: 'test_key_123',
    secret: 'test_secret_abc',
    name: 'Test Client',
    scopes: ['api:public', 'read', 'write'],
    protocols: ['http', 'https'],
    allowedOrigins: ['*'],
    rateLimit: { requests: 100, window: 60 }
  });
  
  // Add to storage
  await api.keypointStorage.set(testKeypoint);
  console.log('Test keypoint created:', testKeypoint.keyId);
  
  // ========== ROUTES ==========
  
  // Simple test route
  api.get('/test', (ctx) => {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': ctx.id
      },
      body: {
        message: 'KeypointJS Framework is working!',
        timestamp: new Date().toISOString(),
        path: ctx.path,
        method: ctx.method,
        protocol: ctx.protocol,
        requestId: ctx.id
      }
    };
  });
  
  // Health check route
  api.get('/health', async (ctx) => {
    try {
      const health = await api.healthCheck();
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: health
      };
    } catch (error) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'Health check failed',
          details: error.message,
          timestamp: new Date().toISOString()
        }
      };
    }
  });
  
  // Echo route - handle POST data
  api.post('/echo', (ctx) => {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        message: 'Echo received',
        data: ctx.body,
        headers: ctx.request?.headers,
        timestamp: new Date().toISOString()
      }
    };
  });
  
  // API info route
  api.get('/', (ctx) => {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        service: 'KeypointJS',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: [
          'GET  /          - This info',
          'GET  /test      - Test endpoint',
          'GET  /health    - Health check',
          'POST /echo      - Echo POST data',
          'GET  /api/*     - API endpoints'
        ],
        docs: 'https://github.com/anasbex-dev/keypointjs'
      }
    };
  });
  
  // ========== START SERVER ==========
  
  console.log('\nStarting server...');
  
  // Use async/await untuk listen
  try {
    await api.listen(3000, 'localhost', (server) => {
      console.log('\n========================================');
      console.log('KEYPOINTJS SERVER STARTED SUCCESSFULLY');
      console.log('========================================');
      console.log('URL: http://localhost:3000');
      console.log('Available endpoints:');
      console.log('   GET  /          - API information');
      console.log('   GET  /test      - Test endpoint');
      console.log('   GET  /health    - Health check');
      console.log('   POST /echo      - Echo POST data');
      console.log('');
      console.log('Mode: Development (Keypoint validation DISABLED)');
      console.log('Test: curl http://localhost:3000/test');
      console.log('Health: curl http://localhost:3000/health');
      console.log('Press Ctrl+C to stop');
      console.log('========================================\n');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down KeypointJS...');
      try {
        await api.shutdown();
        console.log('KeypointJS shutdown complete');
      } catch (e) {
        console.log('Shutdown error:', e.message);
      }
      process.exit(0);
    });
    
  } catch (listenError) {
    console.log('Failed to start server:', listenError.message);
    process.exit(1);
  }
  
} catch (error) {
  console.log('\nERROR LOADING FRAMEWORK:');
  console.log('===========================');
  console.log('Message:', error.message);
  
  if (error.stack) {
    console.log('\nStack trace:');
    console.log(error.stack.split('\n').slice(0, 5).join('\n'));
  }
  
  // Start simple fallback server
  console.log('\n Starting fallback server...');
  import('http').then(http => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Fallback': 'true'
      });
      res.end(JSON.stringify({
        status: 'error',
        message: 'KeypointJS framework failed to load',
        error: error.message,
        timestamp: new Date().toISOString(),
        suggestion: 'Check framework implementation'
      }, null, 2));
    });
    
    server.listen(3000, () => {
      console.log(' Fallback server on http://localhost:3000');
      console.log('Please fix the framework errors');
    });
  });
}