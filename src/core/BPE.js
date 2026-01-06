// core/BaseProtocolEngine.js

export class BaseProtocolEngine {
  constructor(options = {}) {
    this.options = options;
    this.supportedVersions = new Set();
    this.middlewares = [];
  }
  
  // Abstract methods (must be implemented by subclasses)
  async detect(request) {
    throw new Error('Method not implemented');
  }
  
  async parse(request) {
    throw new Error('Method not implemented');
  }
  
  async validate(context) {
    throw new Error('Method not implemented');
  }
  
  async process(request) {
    throw new Error('Method not implemented');
  }
  
  // Common methods
  addMiddleware(middleware) {
    this.middlewares.push(middleware);
  }
  
  async runMiddlewares(context) {
    for (const middleware of this.middlewares) {
      await middleware(context);
    }
  }
  
  createContext(request) {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      protocol: this.protocolName,
      request,
      metadata: {}
    };
  }
}