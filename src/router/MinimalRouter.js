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
      const allowedMethods = [...this.routes.keys()]
        .filter((routeKey) => routeKey.slice(routeKey.indexOf(':') + 1) === request.url.pathname)
        .map((routeKey) => routeKey.slice(0, routeKey.indexOf(':')));

      if (request.method === 'OPTIONS' && allowedMethods.length > 0) {
        context.response = {
          status: 204,
          headers: { Allow: [...new Set([...allowedMethods, 'OPTIONS'])].sort().join(', ') },
          body: null
        };
        return context;
      }

      context.response = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Not Found', code: 404 }
      };
      return context;
    }
    
    const result = await handler(context);
    if (result !== context) context.response = result;
    
    return context;
  }
}
