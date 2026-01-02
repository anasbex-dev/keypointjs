export class MinimalRouter {
  constructor() {
    this.routes = new Map();
  }
  
  route(method, path, handler) {
    const key = `${method}:${path}`;
    this.routes.set(key, handler);
  }
  
  get(path, handler) {
    this.route('GET', path, handler);
  }
  
  post(path, handler) {
    this.route('POST', path, handler);
  }
  
  put(path, handler) {
    this.route('PUT', path, handler);
  }
  
  delete(path, handler) {
    this.route('DELETE', path, handler);
  }
  
  async handle(context) {
    const { request } = context;
    const key = `${request.method}:${request.url.pathname}`;
    
    const handler = this.routes.get(key);
    if (!handler) {
      throw new Error(`Route not found: ${key}`, 404);
    }
    
    const result = await handler(context);
    context.response = result;
    
    return context;
  }
}